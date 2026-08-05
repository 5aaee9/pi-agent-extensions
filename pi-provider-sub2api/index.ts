import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  anthropicMessagesApi,
  createAssistantMessageEventStream,
  openAICodexResponsesApi,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_FILENAME = "sub2api.json";
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const ANTHROPIC_API = anthropicMessagesApi();
const CODEX_API = openAICodexResponsesApi();

// Models that are not chat / reasoning models (e.g. image generators).
const EXCLUDED = /^gpt-image/i;
const CLAUDE = /^claude-/i;

// Models that support extended thinking / reasoning.
const REASONING = /(claude|codex|gpt-5)/i;

// Claude 4.6+ uses adaptive thinking instead of token-budget thinking.
const ADAPTIVE_CLAUDE = /^claude-(?:fable-5|(?:haiku|opus|sonnet)-(?:4-[6-9]|[5-9]))(?:-|$)/i;

interface RelayConfig {
  provider: string;
  accountId: string;
  baseUrl: string;
  anthropicBaseUrl: string;
  apiKey: string;
  responsesUrl: string;
  codexResponsesUrl: string;
  codexAuthToken: string;
}

interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
}

const relaysByProvider = new Map<string, RelayConfig>();

function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

function getConfigPath() {
  return join(getAgentDir(), CONFIG_FILENAME);
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function createRelayAccountId(provider: string) {
  return `sub2api-${Buffer.from(provider, "utf8").toString("base64url")}`;
}

function createCodexAuthToken(accountId: string) {
  return [
    base64Encode(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64Encode(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
        },
      }),
    ),
    "signature",
  ].join(".");
}

function normalizeBaseUrls(value: string) {
  const configured = value.trim().replace(/\/+$/, "");
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseURL must use http or https: ${value}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`baseURL must not include a query or fragment: ${value}`);
  }

  const hasV1Suffix = configured.endsWith("/v1");
  return {
    baseUrl: hasV1Suffix ? configured : `${configured}/v1`,
    // anthropicMessagesApi appends /v1/messages itself.
    anthropicBaseUrl: hasV1Suffix ? configured.slice(0, -3) : configured,
  };
}

function parseRelayConfig(provider: string, value: unknown): RelayConfig {
  if (!provider.trim() || provider !== provider.trim()) {
    throw new Error(`invalid provider name: ${JSON.stringify(provider)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider ${provider} must be an object`);
  }

  const entry = value as { baseURL?: unknown; token?: unknown };
  if (typeof entry.baseURL !== "string" || !entry.baseURL.trim()) {
    throw new Error(`provider ${provider} is missing baseURL`);
  }
  if (typeof entry.token !== "string" || !entry.token.trim()) {
    throw new Error(`provider ${provider} is missing token`);
  }

  const { baseUrl, anthropicBaseUrl } = normalizeBaseUrls(entry.baseURL);
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey: entry.token,
    responsesUrl: `${baseUrl}/responses`,
    codexResponsesUrl: `${baseUrl}/codex/responses`,
    codexAuthToken: createCodexAuthToken(accountId),
  };
}

async function loadRelayConfigs(configPath: string) {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("top-level value must be an object keyed by provider name");
  }
  return Object.entries(parsed).map(([provider, value]) => parseRelayConfig(provider, value));
}

function escapeConfigLiteral(value: string) {
  const escapedDollars = value.replace(/\$/g, "$$$$");
  return escapedDollars.startsWith("!") ? `$!${escapedDollars.slice(1)}` : escapedDollars;
}

function createRelayFetch(relay: RelayConfig, upstreamFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    if (url !== relay.codexResponsesUrl) return upstreamFetch(input, init);

    const headers = new Headers(init?.headers);
    const hasRelayIdentity =
      headers.get("Authorization") === `Bearer ${relay.codexAuthToken}` &&
      headers.get("chatgpt-account-id") === relay.accountId;
    if (!hasRelayIdentity) return upstreamFetch(input, init);

    headers.set("Authorization", `Bearer ${relay.apiKey}`);
    headers.delete("chatgpt-account-id");
    return upstreamFetch(relay.responsesUrl, { ...init, headers });
  };
}

function getModelApi(modelId: string) {
  return CLAUDE.test(modelId) ? "anthropic-messages" : "openai-codex-responses";
}

function getThinkingLevelMap(modelId: string) {
  if (!REASONING.test(modelId)) return undefined;
  return CLAUDE.test(modelId) ? { xhigh: "max" } : { off: "none", xhigh: "xhigh" };
}

function getModelCompat(modelId: string) {
  return ADAPTIVE_CLAUDE.test(modelId) ? { forceAdaptiveThinking: true } : undefined;
}

function getDefaultMaxTokens(modelId: string) {
  return /^claude-haiku-4-5(?:-|$)/i.test(modelId) ? 8192 : 16384;
}

function createStreamErrorMessage(model: { api: string; provider: string; id: string }, error: unknown) {
  return {
    role: "assistant" as const,
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error" as const,
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

function streamSub2Api(model: any, context: any, options: any) {
  const relay = relaysByProvider.get(model.provider);
  if (!relay) {
    return model.api === "anthropic-messages"
      ? ANTHROPIC_API.streamSimple(model, context, options)
      : CODEX_API.streamSimple(model, context, options);
  }

  if (CLAUDE.test(model.id)) {
    return ANTHROPIC_API.streamSimple(
      {
        ...model,
        api: "anthropic-messages",
        baseUrl: relay.anthropicBaseUrl,
        compat: { ...model.compat, ...getModelCompat(model.id) },
      },
      context,
      { ...options, apiKey: relay.apiKey },
    );
  }

  const stream = createAssistantMessageEventStream();
  const upstreamFetch = options?.fetch ?? globalThis.fetch;

  (async () => {
    try {
      const innerStream = CODEX_API.streamSimple(model, context, {
        ...options,
        apiKey: relay.codexAuthToken,
        transport: "sse",
        fetch: createRelayFetch(relay, upstreamFetch),
      });
      for await (const event of innerStream) stream.push(event);
      stream.end();
    } catch (error) {
      const message = createStreamErrorMessage(model, error);
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  })();

  return stream;
}

async function fetchModels(relay: RelayConfig): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(`${relay.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${relay.apiKey}` },
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const payload = (await response.json()) as {
      data?: Array<{
        id?: unknown;
        display_name?: unknown;
        context_window?: unknown;
        max_tokens?: unknown;
      }>;
    };
    if (!Array.isArray(payload.data)) return [];

    return payload.data
      .filter((model): model is typeof model & { id: string } => typeof model.id === "string" && !!model.id)
      .map((model) => ({
        id: model.id,
        name: typeof model.display_name === "string" ? model.display_name : model.id,
        contextWindow: typeof model.context_window === "number" ? model.context_window : undefined,
        maxTokens: typeof model.max_tokens === "number" ? model.max_tokens : undefined,
      }));
  } catch (error) {
    console.error(`[sub2api:${relay.provider}] failed to fetch models:`, error);
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  const configPath = getConfigPath();
  let relays: RelayConfig[];
  try {
    relays = await loadRelayConfigs(configPath);
  } catch (error) {
    console.error(`[sub2api] failed to load ${configPath}:`, error);
    return;
  }

  relaysByProvider.clear();
  for (const relay of relays) relaysByProvider.set(relay.provider, relay);

  const providers = await Promise.all(
    relays.map(async (relay) => ({ relay, models: await fetchModels(relay) })),
  );

  for (const { relay, models } of providers) {
    pi.registerProvider(relay.provider, {
      name: relay.provider,
      baseUrl: relay.baseUrl,
      apiKey: escapeConfigLiteral(relay.apiKey),
      api: "openai-codex-responses",
      streamSimple: streamSub2Api,
      models: models
        .filter((model) => !EXCLUDED.test(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name,
          api: getModelApi(model.id),
          baseUrl: CLAUDE.test(model.id) ? relay.anthropicBaseUrl : undefined,
          reasoning: REASONING.test(model.id),
          thinkingLevelMap: getThinkingLevelMap(model.id),
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow ?? 200000,
          maxTokens: model.maxTokens ?? getDefaultMaxTokens(model.id),
          compat: getModelCompat(model.id),
        })),
    });
  }
}
