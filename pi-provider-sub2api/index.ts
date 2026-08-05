import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const CONFIG_FILENAME = "sub2api.json";
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const CODEX_API = openAICodexResponsesApi();

// Models that are not chat / reasoning models (e.g. image generators).
const EXCLUDED = /^gpt-image/i;
const CLAUDE = /^claude-/i;
const OPENAI = /^(?:chatgpt(?:-|$)|codex(?:-|$)|gpt(?:-|$)|o\d(?:-|$))/i;

const SUPPORTED_APIS = [
  "anthropic-messages",
  "openai-codex-responses",
  "openai-responses",
  "openai-completions",
] as const;
type SupportedApi = (typeof SUPPORTED_APIS)[number];

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
  api?: SupportedApi;
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
  const configured = value.trim();
  if (configured.includes("?") || configured.includes("#")) {
    throw new Error(`baseURL must not include a query or fragment: ${value}`);
  }

  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseURL must use http or https: ${value}`);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  const hasV1Suffix = pathname.endsWith("/v1");
  const createBaseUrl = (nextPathname: string) => {
    const url = new URL(parsed);
    url.pathname = nextPathname || "/";
    return url.toString().replace(/\/$/, "");
  };

  return {
    baseUrl: createBaseUrl(hasV1Suffix ? pathname : `${pathname}/v1`),
    // anthropicMessagesApi appends /v1/messages itself.
    anthropicBaseUrl: createBaseUrl(hasV1Suffix ? pathname.slice(0, -3) : pathname),
  };
}

function parseRelayConfig(provider: string, value: unknown): RelayConfig {
  if (!provider.trim() || provider !== provider.trim()) {
    throw new Error(`invalid provider name: ${JSON.stringify(provider)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider ${provider} must be an object`);
  }

  const entry = value as { baseURL?: unknown; token?: unknown; api?: unknown };
  if (typeof entry.baseURL !== "string" || !entry.baseURL.trim()) {
    throw new Error(`provider ${provider} is missing baseURL`);
  }
  if (typeof entry.token !== "string" || !entry.token.trim()) {
    throw new Error(`provider ${provider} is missing token`);
  }
  if (
    entry.api !== undefined &&
    (typeof entry.api !== "string" || !SUPPORTED_APIS.includes(entry.api as SupportedApi))
  ) {
    throw new Error(
      `provider ${provider} has unsupported api ${JSON.stringify(entry.api)}; expected one of ${SUPPORTED_APIS.join(", ")}`,
    );
  }

  const { baseUrl, anthropicBaseUrl } = normalizeBaseUrls(entry.baseURL);
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey: entry.token,
    api: entry.api as SupportedApi | undefined,
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

function createRelayFetch(
  relay: RelayConfig,
  upstreamFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    if (url !== relay.codexResponsesUrl) return upstreamFetch(input, init);

    const headers = new Headers(init?.headers ?? request?.headers);
    const hasRelayIdentity =
      headers.get("Authorization") === `Bearer ${relay.codexAuthToken}` &&
      headers.get("chatgpt-account-id") === relay.accountId;
    if (!hasRelayIdentity) return upstreamFetch(input, init);

    // Keep the Codex URL and account header intact; only replace the fake JWT
    // with the real Sub2API credential at the request boundary.
    headers.set("Authorization", `Bearer ${relay.apiKey}`);
    return upstreamFetch(input, { ...init, headers });
  };
}

function getModelApi(modelId: string, configuredApi?: SupportedApi): SupportedApi {
  if (configuredApi) return configuredApi;
  if (CLAUDE.test(modelId)) return "anthropic-messages";
  if (OPENAI.test(modelId)) return "openai-codex-responses";
  return "openai-responses";
}

function getApiBaseUrl(relay: RelayConfig, api: SupportedApi) {
  return api === "anthropic-messages" ? relay.anthropicBaseUrl : relay.baseUrl;
}

function getThinkingLevelMap(modelId: string, api: SupportedApi) {
  if (!REASONING.test(modelId)) return undefined;
  return api === "anthropic-messages" ? { xhigh: "max" } : { off: "none", xhigh: "xhigh" };
}

function getModelCompat(modelId: string, api: SupportedApi) {
  return api === "anthropic-messages" && ADAPTIVE_CLAUDE.test(modelId)
    ? { forceAdaptiveThinking: true }
    : undefined;
}

function getDefaultMaxTokens(modelId: string) {
  return /^claude-haiku-4-5(?:-|$)/i.test(modelId) ? 8192 : 16384;
}

function streamCodex(model: any, context: any, options: any) {
  const relay = relaysByProvider.get(model.provider);
  if (!relay) return CODEX_API.streamSimple(model, context, options);

  const upstreamFetch = options?.fetch ?? globalThis.fetch;
  return CODEX_API.streamSimple(model, context, {
    ...options,
    apiKey: relay.codexAuthToken,
    transport: "sse",
    fetch: createRelayFetch(relay, upstreamFetch),
  });
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
      .filter(
        (model): model is typeof model & { id: string } =>
          typeof model.id === "string" && !!model.id,
      )
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
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const api = getModelApi(model.id, relay.api);
        return {
          id: model.id,
          name: model.name,
          api,
          baseUrl: getApiBaseUrl(relay, api),
          reasoning: REASONING.test(model.id),
          thinkingLevelMap: getThinkingLevelMap(model.id, api),
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow ?? 200000,
          maxTokens: model.maxTokens ?? getDefaultMaxTokens(model.id),
          headers:
            api === "openai-codex-responses"
              ? { Authorization: escapeConfigLiteral(`Bearer ${relay.apiKey}`) }
              : undefined,
          compat: getModelCompat(model.id, api),
        };
      });
    const usesCodex = registeredModels.some((model) => model.api === "openai-codex-responses");
    const defaultApi: SupportedApi =
      relay.api ??
      (usesCodex
        ? "openai-codex-responses"
        : ((registeredModels[0]?.api as SupportedApi | undefined) ?? "openai-responses"));

    pi.registerProvider(relay.provider, {
      name: relay.provider,
      baseUrl: getApiBaseUrl(relay, defaultApi),
      apiKey: escapeConfigLiteral(relay.apiKey),
      api: defaultApi,
      ...(usesCodex ? { streamSimple: streamCodex } : {}),
      models: registeredModels,
    });
  }
}
