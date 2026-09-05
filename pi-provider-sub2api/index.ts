import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createAssistantMessageEventStream,
  isContextOverflow,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelCost,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexCompaction } from "./codex-compaction.ts";

type CompatModule = typeof import("@earendil-works/pi-ai/compat");

const CONFIG_FILENAME = "sub2api.json";
const REQUEST_TIMEOUT_MS = 5_000;
const USAGE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const CODEX_STREAM_RETRY_BASE_DELAY_MS = 1_000;
const CODEX_STREAM_RETRY_MAX_DELAY_MS = 30 * 60 * 1_000;
const CODEX_STREAM_RETRY_HEARTBEAT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_TOKEN_LIMIT = 10_000_000;
const USAGE_FOOTER_KEY = "sub2api-usage";
// OMP's pi-compat shim does not export pi's Codex adapter; without it the provider
// registers plain `openai-responses` models (the relay speaks both) and lets the host
// stream natively. Availability depends on the host runtime, so the probe must stay
// dynamic.
async function loadCodexApi(): Promise<ProviderStreams | undefined> {
  try {
    const compat = (await import("@earendil-works/pi-ai/compat")) as CompatModule;
    if (typeof compat.openAICodexResponsesApi !== "function") return undefined;
    return compat.openAICodexResponsesApi();
  } catch {
    return undefined;
  }
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const CODEX_API = await loadCodexApi();

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
const FAST_MODE_APIS = new Set<SupportedApi>([
  "openai-codex-responses",
  "openai-responses",
  "openai-completions",
]);

type ServerToolDefinition = Record<string, unknown>;

interface RelayServerTools {
  responses: ServerToolDefinition[];
  anthropic: ServerToolDefinition[];
}

const SERVER_TOOL_GROUPS = ["responses", "anthropic"] as const;
type ServerToolGroup = (typeof SERVER_TOOL_GROUPS)[number];
const RESPONSES_SERVER_TOOL_API: Partial<Record<SupportedApi, true>> = {
  "openai-codex-responses": true,
  "openai-responses": true,
};
const UNSUPPORTED_RESPONSES_SERVER_TOOL_TYPE: Record<string, true> = {
  apply_patch: true,
  computer: true,
  computer_use: true,
  computer_use_preview: true,
  custom: true,
  function: true,
  image_generation: true,
  local_shell: true,
  namespace: true,
};
const UNSUPPORTED_ANTHROPIC_SERVER_TOOL_PREFIXES = [
  "bash_",
  "computer_",
  "memory_",
  "text_editor_",
];

// Models that support extended thinking / reasoning.
const REASONING = /(claude|codex|gpt-[56])/i;

// Claude 4.6+ uses adaptive thinking instead of token-budget thinking.
const ADAPTIVE_CLAUDE = /^claude-(?:fable-5|(?:haiku|opus|sonnet)-(?:4-[6-9]|[5-9]))(?:-|$)/i;

interface RelayConfig {
  provider: string;
  accountId: string;
  baseUrl: string;
  anthropicBaseUrl: string;
  apiKey: string;
  api?: SupportedApi;
  serverTools?: RelayServerTools;
  responsesUrl: string;
  codexResponsesUrl: string;
  codexAuthToken: string;
}

interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  supportedThinkingLevels?: string[];
  reasoning?: boolean;
  input?: ("text" | "image")[];
}

interface ModelTokenLimits {
  contextWindow?: number;
  maxTokens?: number;
}

interface BuiltinModelMetadata extends ModelTokenLimits {
  cost: ModelCost;
}

type ModelMetadataCatalogs = Map<string, Map<string, BuiltinModelMetadata>>;
const METADATA_PROVIDERS = ["anthropic", "openai", "openai-codex", "xai"] as const;
const BUILTIN_MODEL_METADATA: ModelMetadataCatalogs = new Map(
  METADATA_PROVIDERS.map((provider) => [
    provider,
    new Map<string, BuiltinModelMetadata>(
      getBuiltinModels(provider).map((model) => [model.id, model]),
    ),
  ]),
);
const METADATA_PROVIDERS_BY_API: Record<SupportedApi, (typeof METADATA_PROVIDERS)[number][]> = {
  "anthropic-messages": ["anthropic"],
  "openai-codex-responses": ["openai-codex", "openai"],
  "openai-responses": ["openai", "xai"],
  "openai-completions": ["openai", "xai"],
};

interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  window: string;
  resetAt: string;
}

interface DailyUsage {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  actualCost: number;
}

interface QuotaAmount {
  limit: number;
  used: number;
  remaining: number;
  unit: string;
}

interface BillingInfo {
  billingUrl: string;
  schemaVersion: number;
  billingScope: string;
  groupRateMultiplier: number;
  userRateMultiplier?: number;
  resolvedRateMultiplier: number;
  peakRateEnabled: boolean;
  peakStart?: string;
  peakEnd?: string;
  peakRateMultiplier?: number;
  appliedPeakMultiplier?: number;
  effectiveRateMultiplier: number;
  timezone?: string;
  observedAt?: string;
  lastUpdated: number;
}

interface QuotaInfo {
  usageUrl: string;
  rateLimits: RateLimit[];
  subscriptionLimits: RateLimit[];
  dailyUsage: DailyUsage[];
  todayUsage?: DailyUsage;
  quota?: QuotaAmount;
  todayCost: number;
  totalCost: number;
  planName?: string;
  remaining?: number;
  unit?: string;
  expiresAt?: string;
  status: string;
  mode: string;
  lastUpdated: number;
}

type QuotaRefreshResult =
  | { kind: "ok"; info: QuotaInfo }
  | { kind: "not-found" }
  | { kind: "auth"; status: number }
  | { kind: "temporary"; detail: string }
  | { kind: "invalid" };

type BillingRefreshResult =
  | { kind: "ok"; info: BillingInfo }
  | { kind: "not-found" }
  | { kind: "auth"; status: number }
  | { kind: "temporary"; detail: string }
  | { kind: "invalid" };

const relaysByProvider = new Map<string, RelayConfig>();
const quotaByProvider = new Map<string, QuotaInfo>();
const billingByProvider = new Map<string, BillingInfo>();
const quotaRefreshes = new Map<string, Promise<QuotaRefreshResult>>();
const billingRefreshes = new Map<string, Promise<BillingRefreshResult>>();
let activeExtensionGeneration = 0;

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

function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function hasControlCharacters(value: string) {
  return [...value].some(isControlCharacter);
}

function sanitizeDisplayString(value: string, maxLength = 256) {
  return [...value.replace(ANSI_ESCAPE, "")]
    .filter((character) => !isControlCharacter(character))
    .join("")
    .trim()
    .slice(0, maxLength);
}

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !hasControlCharacters(value)
  );
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
  const description = JSON.stringify(value);
  if (hasControlCharacters(value)) {
    throw new Error(`baseURL must not include control characters: ${description}`);
  }
  if (configured.includes("?") || configured.includes("#")) {
    throw new Error(`baseURL must not include a query or fragment: ${description}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`invalid baseURL: ${description}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseURL must use http or https: ${description}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`baseURL must not include credentials: ${description}`);
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

function serverToolLabel(provider: string, group: ServerToolGroup, index: number) {
  return `provider ${provider} serverTools.${group}[${index}]`;
}

function validateResponsesServerTool(
  provider: string,
  index: number,
  tool: ServerToolDefinition,
  type: string,
) {
  const label = serverToolLabel(provider, "responses", index);
  if (UNSUPPORTED_RESPONSES_SERVER_TOOL_TYPE[type] === true) {
    throw new Error(
      `${label} type ${JSON.stringify(type)} requires client-side handling or returns output Pi cannot retain`,
    );
  }

  if (type === "file_search") {
    if (
      !Array.isArray(tool.vector_store_ids) ||
      tool.vector_store_ids.length === 0 ||
      tool.vector_store_ids.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw new Error(`${label} file_search requires non-empty vector_store_ids`);
    }
  }

  if (type === "code_interpreter") {
    const container = tool.container;
    const autoContainer = asRecord(container);
    if (!((typeof container === "string" && container.trim()) || autoContainer?.type === "auto")) {
      throw new Error(`${label} code_interpreter requires a container ID or { "type": "auto" }`);
    }
  }

  if (type === "shell") {
    const environment = asRecord(tool.environment);
    if (
      !environment ||
      (environment.type !== "container_auto" && environment.type !== "container_reference")
    ) {
      throw new Error(`${label} shell requires a hosted container environment`);
    }
    if (
      environment.type === "container_reference" &&
      (typeof environment.container_id !== "string" || !environment.container_id.trim())
    ) {
      throw new Error(`${label} shell container_reference requires container_id`);
    }
  }

  if (type === "mcp") {
    if (typeof tool.server_label !== "string" || !tool.server_label.trim()) {
      throw new Error(`${label} mcp requires server_label`);
    }
    if (
      !(
        (typeof tool.server_url === "string" && tool.server_url.trim()) ||
        (typeof tool.connector_id === "string" && tool.connector_id.trim())
      )
    ) {
      throw new Error(`${label} mcp requires server_url or connector_id`);
    }
    if (tool.require_approval !== "never") {
      throw new Error(`${label} mcp requires require_approval "never"; Pi cannot approve calls`);
    }
  }

  if (type === "tool_search" && tool.execution !== "server") {
    throw new Error(`${label} tool_search requires execution "server"`);
  }
}

function validateAnthropicServerTool(
  provider: string,
  index: number,
  tool: ServerToolDefinition,
  type: string,
) {
  const label = serverToolLabel(provider, "anthropic", index);
  if (UNSUPPORTED_ANTHROPIC_SERVER_TOOL_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    throw new Error(
      `${label} type ${JSON.stringify(type)} requires client-side handling and is not a server tool`,
    );
  }

  const expectedName = type.startsWith("web_search_")
    ? "web_search"
    : type.startsWith("web_fetch_")
      ? "web_fetch"
      : type.startsWith("code_execution_")
        ? "code_execution"
        : type.startsWith("tool_search_tool_regex")
          ? "tool_search_tool_regex"
          : type.startsWith("tool_search_tool_bm25")
            ? "tool_search_tool_bm25"
            : undefined;
  if (expectedName && tool.name !== expectedName) {
    throw new Error(`${label} type ${JSON.stringify(type)} requires name ${expectedName}`);
  }
}

function parseServerToolList(
  provider: string,
  group: ServerToolGroup,
  value: unknown,
): ServerToolDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`provider ${provider} serverTools.${group} must be an array`);
  }

  return value.map((candidate, index) => {
    const tool = asRecord(candidate);
    const label = serverToolLabel(provider, group, index);
    if (!tool) throw new Error(`${label} must be an object`);
    if (
      typeof tool.type !== "string" ||
      !tool.type.trim() ||
      tool.type !== tool.type.trim() ||
      tool.type.length > 128 ||
      hasControlCharacters(tool.type)
    ) {
      throw new Error(`${label} must have a valid non-empty type`);
    }

    if (group === "responses") {
      validateResponsesServerTool(provider, index, tool, tool.type);
    } else {
      validateAnthropicServerTool(provider, index, tool, tool.type);
    }
    return structuredClone(tool);
  });
}

function parseServerTools(provider: string, value: unknown): RelayServerTools | undefined {
  if (value === undefined) return undefined;
  const config = asRecord(value);
  if (!config) throw new Error(`provider ${provider} serverTools must be an object`);

  const unknownGroup = Object.keys(config).find(
    (group) => !SERVER_TOOL_GROUPS.includes(group as ServerToolGroup),
  );
  if (unknownGroup !== undefined) {
    throw new Error(
      `provider ${provider} has unsupported serverTools group ${JSON.stringify(unknownGroup)}; expected responses or anthropic`,
    );
  }

  const serverTools = {
    responses: parseServerToolList(provider, "responses", config.responses),
    anthropic: parseServerToolList(provider, "anthropic", config.anthropic),
  };
  return serverTools.responses.length > 0 || serverTools.anthropic.length > 0
    ? serverTools
    : undefined;
}

function validateServerToolsForApi(
  provider: string,
  api: SupportedApi | undefined,
  serverTools: RelayServerTools | undefined,
) {
  if (!api || !serverTools) return;
  if (RESPONSES_SERVER_TOOL_API[api] === true && serverTools.anthropic.length > 0) {
    throw new Error(`provider ${provider} cannot use serverTools.anthropic with api ${api}`);
  }
  if (api === "anthropic-messages" && serverTools.responses.length > 0) {
    throw new Error(`provider ${provider} cannot use serverTools.responses with api ${api}`);
  }
  if (api === "openai-completions") {
    throw new Error(`provider ${provider} cannot use serverTools with api openai-completions`);
  }
}

function parseRelayConfig(provider: string, value: unknown): RelayConfig {
  if (
    !provider.trim() ||
    provider !== provider.trim() ||
    provider.length > 128 ||
    hasControlCharacters(provider)
  ) {
    throw new Error(`invalid provider name: ${JSON.stringify(provider)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider ${provider} must be an object`);
  }

  const entry = value as {
    baseURL?: unknown;
    token?: unknown;
    api?: unknown;
    serverTools?: unknown;
  };
  if (typeof entry.baseURL !== "string" || !entry.baseURL.trim()) {
    throw new Error(`provider ${provider} is missing baseURL`);
  }
  if (typeof entry.token !== "string" || !entry.token.trim()) {
    throw new Error(`provider ${provider} is missing token`);
  }
  if (hasControlCharacters(entry.token)) {
    throw new Error(`provider ${provider} token must not include control characters`);
  }
  if (
    entry.api !== undefined &&
    (typeof entry.api !== "string" || !SUPPORTED_APIS.includes(entry.api as SupportedApi))
  ) {
    throw new Error(
      `provider ${provider} has unsupported api ${JSON.stringify(entry.api)}; expected one of ${SUPPORTED_APIS.join(", ")}`,
    );
  }

  const configuredApi = entry.api as SupportedApi | undefined;
  const serverTools = parseServerTools(provider, entry.serverTools);
  validateServerToolsForApi(provider, configuredApi, serverTools);

  const { baseUrl, anthropicBaseUrl } = normalizeBaseUrls(entry.baseURL);
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey: entry.token,
    api: configuredApi,
    serverTools,
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

function isRetryableError(error: unknown) {
  if (error instanceof DOMException) {
    return ["AbortError", "NetworkError", "TimeoutError"].includes(error.name);
  }
  if (!(error instanceof Error)) return false;

  const cause = error.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code.toLowerCase() : "";
  const message = error.message.toLowerCase();
  return (
    ["eai_again", "econnrefused", "econnreset", "enotfound", "etimedout"].includes(code) ||
    ["fetch failed", "socket hang up", "terminated", "timeout"].some((fragment) =>
      message.includes(fragment),
    )
  );
}

function isRetryableStatus(status: number) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function waitBeforeRetry(attempt: number, signal?: AbortSignal) {
  const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
  await new Promise<void>((resolveDelay, rejectDelay) => {
    if (signal?.aborted) {
      rejectDelay(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveDelay();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type TextFetchResult =
  | { response: Response; text: string }
  | { response: Response; bodyError: unknown }
  | { response: Response };

async function fetchTextWithRetry(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<TextFetchResult | null> {
  const canRetry = (init.method ?? "GET").toUpperCase() === "GET";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (init.signal?.aborted) return null;
    let shouldRetry = false;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(url, { ...init, redirect: "error", signal });
      if (canRetry && isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        discardResponse(response);
        shouldRetry = true;
      } else if (!response.ok) {
        return { response };
      } else {
        try {
          return { response, text: await readResponseText(response) };
        } catch (bodyError) {
          discardResponse(response);
          if (
            canRetry &&
            !init.signal?.aborted &&
            isRetryableError(bodyError) &&
            attempt < MAX_RETRIES
          ) {
            shouldRetry = true;
          } else {
            return { response, bodyError };
          }
        }
      }
    } catch (error) {
      if (canRetry && !init.signal?.aborted && isRetryableError(error) && attempt < MAX_RETRIES) {
        shouldRetry = true;
      } else {
        return null;
      }
    }

    if (!shouldRetry) return null;
    try {
      await waitBeforeRetry(attempt, init.signal ?? undefined);
    } catch {
      return null;
    }
  }
  return null;
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

    // Sub2API relays do not expose ChatGPT's Codex passthrough route; rewrite
    // the request to the standard Responses endpoint, drop the fake account
    // identity, and replace only the fake JWT with the real relay credential.
    headers.set("Authorization", `Bearer ${relay.apiKey}`);
    headers.delete("chatgpt-account-id");
    return upstreamFetch(relay.responsesUrl, { ...init, headers, redirect: "error" });
  };
}

function getModelApi(modelId: string, configuredApi?: SupportedApi): SupportedApi {
  if (!CODEX_API && configuredApi === "openai-codex-responses") return "openai-responses";
  if (configuredApi) return configuredApi;
  if (CLAUDE.test(modelId)) return "anthropic-messages";
  // OpenAI models use pi's Codex adapter for its Codex-shaped requests; the
  // relay fetch rewrites them to the standard /v1/responses endpoint.
  // Hosts without pi's adapter (OMP) take the plain Responses API instead.
  if (OPENAI.test(modelId)) return CODEX_API ? "openai-codex-responses" : "openai-responses";
  return "openai-responses";
}

function getApiBaseUrl(relay: RelayConfig, api: SupportedApi) {
  return api === "anthropic-messages" ? relay.anthropicBaseUrl : relay.baseUrl;
}

function getThinkingLevelMap(
  reasoning: boolean,
  api: SupportedApi,
  supportedThinkingLevels?: string[],
  ultraEnabled = false,
) {
  if (!reasoning) return undefined;
  if (api === "anthropic-messages") return { xhigh: "max" };
  // Relayed Codex backends reject the "none" and "minimal" efforts with
  // upstream 5xx errors, so clamp minimal to low. The Codex adapter omits the
  // reasoning field entirely when thinking is off, while the plain Responses
  // adapter requires off to be unselectable (null) to do the same.
  const map =
    api === "openai-codex-responses"
      ? { off: "none", minimal: "low", xhigh: "xhigh" }
      : { off: null, minimal: "low", xhigh: "xhigh" };
  if (!supportedThinkingLevels) return map;

  const supported = new Set(supportedThinkingLevels);
  return {
    ...map,
    minimal: supported.has("low") ? "low" : null,
    low: supported.has("low") ? "low" : null,
    medium: supported.has("medium") ? "medium" : null,
    high: supported.has("high") ? "high" : null,
    xhigh: supported.has("xhigh") ? "xhigh" : null,
    max:
      ultraEnabled && supported.has("ultra")
        ? "ultra"
        : supported.has("max")
          ? "max"
          : supported.has("ultra")
            ? "ultra"
            : null,
  };
}

function getModelCompat(modelId: string, api: SupportedApi) {
  return api === "anthropic-messages" && ADAPTIVE_CLAUDE.test(modelId)
    ? { forceAdaptiveThinking: true }
    : undefined;
}

function getDefaultMaxTokens(modelId: string) {
  return /^claude-haiku-4-5(?:-|$)/i.test(modelId) ? 8192 : 16384;
}

function getModelMetadataIds(modelId: string) {
  return modelId.toLowerCase() === "gpt-5.6" ? [modelId, "gpt-5.6-sol"] : [modelId];
}

async function loadCachedModelMetadata(): Promise<ModelMetadataCatalogs | undefined> {
  try {
    const agentDir = getAgentDir();
    const modelsStorePath = join(agentDir, "models-store.json");
    await access(modelsStorePath);
    const [{ ModelRuntime }, { InMemoryCredentialStore }] = await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("@earendil-works/pi-ai"),
    ]);
    if (
      typeof ModelRuntime?.create !== "function" ||
      typeof InMemoryCredentialStore !== "function"
    ) {
      return undefined;
    }
    // Use the host SDK to restore its cached catalog, rather than parsing a
    // private store format or resolving the user's provider credentials.
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath,
      allowModelNetwork: false,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return new Map(
      METADATA_PROVIDERS.map((provider) => [
        provider,
        new Map(
          runtime
            .getModels(provider)
            .map((model) => [
              model.id,
              { contextWindow: model.contextWindow, maxTokens: model.maxTokens, cost: model.cost },
            ]),
        ),
      ]),
    );
  } catch {
    // Missing/unreadable caches and hosts without ModelRuntime keep the static
    // catalog fallback. Metadata restoration failures must not prevent discovery.
    return undefined;
  }
}

function getBuiltinModelMetadata(
  modelId: string,
  api: SupportedApi,
  cachedMetadata?: ModelMetadataCatalogs,
) {
  for (const candidate of getModelMetadataIds(modelId)) {
    for (const provider of METADATA_PROVIDERS_BY_API[api]) {
      const metadata =
        cachedMetadata?.get(provider)?.get(candidate) ??
        BUILTIN_MODEL_METADATA.get(provider)?.get(candidate);
      if (metadata) return metadata;
    }
  }
  return undefined;
}

function scaleModelCost(cost: ModelCost | undefined, multiplier: number): ModelCost {
  if (!cost) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const scaleRates = <T extends ModelCost>(rates: T): T => ({
    ...rates,
    input: rates.input * multiplier,
    output: rates.output * multiplier,
    cacheRead: rates.cacheRead * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
  });
  return {
    ...scaleRates(cost),
    tiers: cost.tiers?.map((tier) => scaleRates(tier)),
  };
}

function codexRetryDelayMs(attempt: number) {
  return Math.min(
    CODEX_STREAM_RETRY_MAX_DELAY_MS,
    CODEX_STREAM_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 30),
  );
}

function waitForCodexRetry(delayMs: number, signal?: AbortSignal, onHeartbeat?: () => void) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolveWait) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remainingMs = delayMs;
    const finish = (completed: boolean) => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveWait(completed);
    };
    const onAbort = () => finish(false);
    const waitForNextSlice = () => {
      const sliceMs = Math.min(remainingMs, CODEX_STREAM_RETRY_HEARTBEAT_MS);
      timer = setTimeout(() => {
        remainingMs -= sliceMs;
        if (remainingMs <= 0) finish(true);
        else {
          onHeartbeat?.();
          waitForNextSlice();
        }
      }, sliceMs);
    };
    waitForNextSlice();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function assistantMessageFromError(
  model: Model<any>,
  prior: AssistantMessage | undefined,
  stopReason: "error" | "aborted",
  errorMessage?: string,
): AssistantMessage {
  return {
    ...(prior ?? {
      role: "assistant",
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
      timestamp: Date.now(),
    }),
    stopReason,
    errorMessage,
  };
}

function createCodexAttemptSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const abortAttempt = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortAttempt();
  else parent?.addEventListener("abort", abortAttempt, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      parent?.removeEventListener("abort", abortAttempt);
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pushCodexTerminalEvent(
  stream: AssistantMessageEventStream,
  event: Extract<AssistantMessageEvent, { type: "done" | "error" }>,
  streamStarted: boolean,
) {
  if (!streamStarted) {
    const finalMessage = event.type === "done" ? event.message : event.error;
    stream.push({
      type: "start",
      partial: {
        ...structuredClone(finalMessage),
        stopReason: "pending",
        errorMessage: undefined,
      },
    });
  }
  stream.push(structuredClone(event));
  stream.end();
}

function pushCodexTerminalError(
  stream: AssistantMessageEventStream,
  model: Model<any>,
  prior: AssistantMessage | undefined,
  stopReason: "error" | "aborted",
  message?: string,
  streamStarted = false,
) {
  const error = assistantMessageFromError(model, prior, stopReason, message);
  pushCodexTerminalEvent(stream, { type: "error", reason: stopReason, error }, streamStarted);
}

function pushCodexRetryHeartbeat(
  stream: AssistantMessageEventStream,
  model: Model<any>,
  prior: AssistantMessage | undefined,
  streamStarted: boolean,
) {
  const partial: AssistantMessage = {
    ...assistantMessageFromError(model, prior, "error"),
    content: [{ type: "text", text: "" }],
    stopReason: "pending",
    errorMessage: undefined,
  };
  if (!streamStarted) {
    stream.push({
      type: "start",
      partial: { ...structuredClone(partial), content: [] },
    });
  }
  stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(partial) });
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: "",
    partial: structuredClone(partial),
  });
  return true;
}

function streamCodexWithRetry(
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (!CODEX_API) throw new Error("pi Codex adapter unavailable on this host");
  const stream = createAssistantMessageEventStream();
  let streamStarted = false;
  let streamPartial: AssistantMessage | undefined;
  void (async () => {
    let retryAttempt = 0;

    for (;;) {
      let retryReason: string | undefined;
      const attemptSignal = createCodexAttemptSignal(options.signal);
      const attemptHeartbeat = setInterval(() => {
        streamStarted = pushCodexRetryHeartbeat(stream, model, streamPartial, streamStarted);
      }, CODEX_STREAM_RETRY_HEARTBEAT_MS);
      try {
        const attemptStream = CODEX_API.streamSimple(model, context, {
          ...options,
          signal: attemptSignal.signal,
        });
        for await (const event of attemptStream) {
          if (event.type === "start") {
            streamPartial = event.partial;
            if (!streamStarted) {
              // Publish the lifecycle start as soon as generation begins so
              // message_start/message_end consumers can measure real elapsed
              // time. Keep buffering content events so a retried attempt cannot
              // leak stale partial output into the outer stream.
              stream.push(structuredClone(event));
              streamStarted = true;
            }
          }
          if (event.type === "error") {
            if (options.signal?.aborted) {
              pushCodexTerminalError(stream, model, undefined, "aborted", undefined, streamStarted);
              return;
            }
            if (isContextOverflow(event.error, model.contextWindow)) {
              pushCodexTerminalEvent(stream, event, streamStarted);
              return;
            }
            retryReason = event.error.errorMessage ?? "Unknown upstream error";
            break;
          }

          if (event.type === "done") {
            pushCodexTerminalEvent(stream, event, streamStarted);
            return;
          }
        }
      } catch (error) {
        if (options.signal?.aborted) {
          pushCodexTerminalError(stream, model, undefined, "aborted", undefined, streamStarted);
          return;
        }
        const message = errorMessage(error);
        const assistantError = assistantMessageFromError(model, undefined, "error", message);
        if (isContextOverflow(assistantError, model.contextWindow)) {
          pushCodexTerminalEvent(
            stream,
            { type: "error", reason: "error", error: assistantError },
            streamStarted,
          );
          return;
        }
        retryReason = message;
      } finally {
        clearInterval(attemptHeartbeat);
        attemptSignal.cleanup();
      }

      retryReason ??= "Codex stream ended without a terminal event";
      retryAttempt += 1;
      const delayMs = codexRetryDelayMs(retryAttempt);
      console.warn(
        `[sub2api:${model.provider}] Codex upstream error (${retryReason}); retry ${retryAttempt} in ${Math.ceil(delayMs / 1000)}s`,
      );
      streamStarted = pushCodexRetryHeartbeat(stream, model, streamPartial, streamStarted);
      if (
        !(await waitForCodexRetry(delayMs, options.signal, () => {
          streamStarted = pushCodexRetryHeartbeat(stream, model, streamPartial, streamStarted);
        }))
      ) {
        pushCodexTerminalError(stream, model, undefined, "aborted", undefined, streamStarted);
        return;
      }
    }
  })().catch((error) => {
    pushCodexTerminalError(stream, model, undefined, "error", errorMessage(error), streamStarted);
  });
  return stream;
}

function streamCodex(
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions = {},
): AssistantMessageEventStream {
  const relay = relaysByProvider.get(model.provider);
  if (!CODEX_API) throw new Error("pi Codex adapter unavailable on this host");
  if (!relay) return CODEX_API.streamSimple(model, context, options);

  const upstreamFetch = options.fetch ?? globalThis.fetch;
  return streamCodexWithRetry(model, context, {
    ...options,
    apiKey: relay.codexAuthToken,
    transport: "sse",
    fetch: createRelayFetch(relay, upstreamFetch),
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function addServerTools(payload: unknown, model: Model<any> | undefined) {
  if (!model) return undefined;
  const relay = relaysByProvider.get(model.provider);
  if (!relay?.serverTools) return undefined;

  const configuredTools =
    RESPONSES_SERVER_TOOL_API[model.api as SupportedApi] === true
      ? relay.serverTools.responses
      : model.api === "anthropic-messages"
        ? relay.serverTools.anthropic
        : [];
  if (configuredTools.length === 0) return undefined;

  const request = asRecord(payload);
  if (!request || request.model !== model.id) return undefined;
  if (request.tools !== undefined && !Array.isArray(request.tools)) return undefined;

  const tools = [...((request.tools as unknown[] | undefined) ?? [])];
  let changed = false;
  for (const configuredTool of configuredTools) {
    if (tools.some((tool) => isDeepStrictEqual(tool, configuredTool))) continue;
    tools.push(structuredClone(configuredTool));
    changed = true;
  }
  return changed ? { ...request, tools } : undefined;
}

function addFastServiceTier(payload: unknown, model: Model<any> | undefined) {
  if (
    !model ||
    !relaysByProvider.has(model.provider) ||
    !OPENAI.test(model.id) ||
    !FAST_MODE_APIS.has(model.api as SupportedApi)
  ) {
    return undefined;
  }
  const request = asRecord(payload);
  if (!request || request.model !== model.id) return undefined;
  return { ...request, service_tier: "priority" };
}

function discardResponse(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}

async function readResponseText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function toPositiveInteger(value: unknown) {
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_MODEL_TOKEN_LIMIT
    ? parsed
    : undefined;
}

function firstPositiveInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = toPositiveInteger(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function firstMaxTokensWithinContext(
  contextWindow: number | undefined,
  ...values: (number | undefined)[]
) {
  return values.find(
    (value): value is number =>
      value !== undefined && (contextWindow === undefined || value <= contextWindow),
  );
}

function pickRemoteContextWindow(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return firstPositiveInteger(
    model.context_window,
    model.contextWindow,
    model.context_length,
    model.max_context_tokens,
    limit?.context,
    limits?.context,
  );
}

function pickRemoteMaxTokens(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return firstPositiveInteger(
    model.max_tokens,
    model.maxTokens,
    model.max_output_tokens,
    model.max_completion_tokens,
    limit?.output,
    limits?.output,
  );
}

function pickRemoteThinkingLevels(model: Record<string, unknown>) {
  const raw = model.supported_reasoning_levels ?? model.supportedReasoningLevels;
  if (!Array.isArray(raw)) return undefined;

  const supported = new Set<string>();
  let recognized = raw.length === 0;
  for (const value of raw) {
    const effort = typeof value === "string" ? value : asRecord(value)?.effort;
    if (typeof effort !== "string") continue;
    const normalized = effort.trim().toLowerCase();
    if (normalized === "none") {
      recognized = true;
    } else if (["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(normalized)) {
      supported.add(normalized);
      recognized = true;
    }
  }
  return recognized ? [...supported] : undefined;
}

function mergeSupportedThinkingLevels(...levels: (string[] | undefined)[]) {
  const supported = new Set(levels.flatMap((values) => values ?? []));
  if (!levels.some((values) => values !== undefined)) return undefined;
  return ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].filter((level) =>
    supported.has(level),
  );
}

async function fetchModelInventory(relay: RelayConfig): Promise<DiscoveredModel[]> {
  try {
    const result = await fetchTextWithRetry(`${relay.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
    });
    if (!result) throw new Error("request failed after retries");
    if (!result.response.ok) {
      discardResponse(result.response);
      throw new Error(`HTTP ${result.response.status} ${result.response.statusText}`.trim());
    }
    if ("bodyError" in result) throw result.bodyError;
    if (!("text" in result)) throw new Error("model response body is unavailable");

    const payload = asRecord(JSON.parse(result.text) as unknown);
    if (!Array.isArray(payload?.data)) return [];

    const seen = new Set<string>();
    return payload.data
      .map(asRecord)
      .filter((model): model is Record<string, unknown> => Boolean(model))
      .filter((model): model is Record<string, unknown> & { id: string } => {
        if (!isSafeModelId(model.id) || seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      })
      .map((model) => {
        const displayName =
          typeof model.display_name === "string"
            ? sanitizeDisplayString(model.display_name)
            : typeof model.name === "string"
              ? sanitizeDisplayString(model.name)
              : "";
        return {
          id: model.id,
          name: displayName || model.id,
          contextWindow: pickRemoteContextWindow(model),
          maxTokens: pickRemoteMaxTokens(model),
          supportedThinkingLevels: pickRemoteThinkingLevels(model),
        };
      });
  } catch (error) {
    console.error(`[sub2api:${relay.provider}] failed to fetch models:`, error);
    return [];
  }
}

async function fetchCodexManifest(relay: RelayConfig) {
  const models = new Map<string, DiscoveredModel>();
  try {
    const result = await fetchTextWithRetry(`${relay.anthropicBaseUrl}/backend-api/codex/models`, {
      headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
    });
    if (!result) throw new Error("request failed after retries");
    if (!result.response.ok) {
      discardResponse(result.response);
      throw new Error(`HTTP ${result.response.status} ${result.response.statusText}`.trim());
    }
    if ("bodyError" in result) throw result.bodyError;
    if (!("text" in result)) throw new Error("Codex manifest response body is unavailable");

    const payload = asRecord(JSON.parse(result.text) as unknown);
    if (!Array.isArray(payload?.models))
      throw new Error("Codex manifest must contain a models array");
    for (const value of payload.models) {
      const model = asRecord(value);
      if (!model || !isSafeModelId(model.slug) || models.has(model.slug)) continue;
      const supportedThinkingLevels = pickRemoteThinkingLevels(model);
      const input = Array.isArray(model.input_modalities)
        ? model.input_modalities.filter(
            (value): value is "text" | "image" => value === "text" || value === "image",
          )
        : [];
      const displayName =
        typeof model.display_name === "string" ? sanitizeDisplayString(model.display_name) : "";
      models.set(model.slug, {
        id: model.slug,
        name: displayName || model.slug,
        contextWindow: pickRemoteContextWindow(model),
        maxTokens: pickRemoteMaxTokens(model),
        supportedThinkingLevels,
        reasoning: Boolean(supportedThinkingLevels?.length),
        input: input.length ? [...new Set(input)] : ["text"],
      });
    }
  } catch (error) {
    // Explicit Codex relays require the manifest; auto/other API relays only
    // use it as optional metadata enrichment and retain their inventory.
    if (relay.api === "openai-codex-responses") {
      console.error(`[sub2api:${relay.provider}] failed to fetch Codex model manifest:`, error);
    }
  }
  return models;
}

async function fetchModels(relay: RelayConfig): Promise<DiscoveredModel[]> {
  if (relay.api === "openai-codex-responses") {
    return [...(await fetchCodexManifest(relay)).values()];
  }
  const models = await fetchModelInventory(relay);
  const needsCodexMetadata = models.some(
    (model) =>
      !EXCLUDED.test(model.id) &&
      OPENAI.test(model.id) &&
      (model.contextWindow === undefined ||
        model.maxTokens === undefined ||
        model.maxTokens > model.contextWindow ||
        (REASONING.test(model.id) && !model.supportedThinkingLevels?.includes("ultra"))),
  );
  if (!needsCodexMetadata) return models;

  const manifest = await fetchCodexManifest(relay);
  if (!manifest.size) return models;
  return models.map((model) => {
    if (!OPENAI.test(model.id)) return model;
    const metadata = getModelMetadataIds(model.id)
      .map((candidate) => manifest.get(candidate))
      .filter((limits): limits is DiscoveredModel => limits !== undefined);
    if (!metadata.length) return model;
    const contextWindow =
      model.contextWindow ??
      firstPositiveInteger(...metadata.map((limits) => limits.contextWindow));
    const maxTokens = firstMaxTokensWithinContext(
      contextWindow,
      model.maxTokens,
      ...metadata.map((limits) => limits.maxTokens),
    );
    const supportedThinkingLevels = mergeSupportedThinkingLevels(
      model.supportedThinkingLevels,
      ...metadata.map((limits) => limits.supportedThinkingLevels),
    );
    return {
      ...model,
      contextWindow,
      maxTokens,
      supportedThinkingLevels,
    };
  });
}

function toFiniteNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toNonNegativeNumber(value: unknown) {
  const parsed = toFiniteNumber(value);
  return parsed === undefined ? undefined : Math.max(0, parsed);
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNonNegativeNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function firstStrictNonNegativeNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined && parsed >= 0) return parsed;
  }
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const sanitized = sanitizeDisplayString(value);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function hasQuotaFields(value: Record<string, unknown>) {
  return [
    "mode",
    "quota",
    "subscription",
    "planName",
    "plan_name",
    "rate_limits",
    "rateLimits",
    "daily_usage",
    "dailyUsage",
    "usage",
  ].some((key) => key in value);
}

function selectQuotaPayload(value: unknown) {
  const root = asRecord(value);
  if (!root) return undefined;
  if (hasQuotaFields(root)) return root;
  const data = asRecord(root.data);
  return data && hasQuotaFields(data) ? data : undefined;
}

function parseRateLimits(payload: Record<string, unknown>) {
  const usage = asRecord(payload.usage);
  const raw = payload.rate_limits ?? payload.rateLimits ?? usage?.rate_limits ?? usage?.rateLimits;
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 100).flatMap((value): RateLimit[] => {
    const entry = asRecord(value);
    if (!entry) return [];
    const limit = firstNumber(entry.limit, entry.total) ?? 0;
    const reportedRemaining = firstNumber(entry.remaining, entry.left);
    const reportedUsed = firstNumber(entry.used, entry.consumed);
    const used = reportedUsed ?? Math.max(0, limit - (reportedRemaining ?? limit));
    const remaining = reportedRemaining ?? Math.max(0, limit - used);
    return [
      {
        limit,
        remaining,
        used,
        window: firstString(entry.window, entry.period, entry.name) ?? "default",
        resetAt: firstString(entry.reset_at, entry.resetAt, entry.resets_at) ?? "",
      },
    ];
  });
}

function parseDailyUsage(payload: Record<string, unknown>) {
  const usage = asRecord(payload.usage);
  const raw = payload.daily_usage ?? payload.dailyUsage ?? usage?.daily_usage ?? usage?.dailyUsage;
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 400).flatMap((value): DailyUsage[] => {
    const entry = asRecord(value);
    if (!entry) return [];
    return [parseUsageEntry(entry)];
  });
}

function parseUsageEntry(entry: Record<string, unknown>, fallbackDate = "") {
  const inputTokens = firstNumber(entry.input_tokens, entry.inputTokens) ?? 0;
  const outputTokens = firstNumber(entry.output_tokens, entry.outputTokens) ?? 0;
  const cacheReadTokens = firstNumber(entry.cache_read_tokens, entry.cacheReadTokens) ?? 0;
  const cacheWriteTokens =
    firstNumber(
      entry.cache_write_tokens,
      entry.cacheWriteTokens,
      entry.cache_creation_tokens,
      entry.cacheCreationTokens,
    ) ?? 0;
  return {
    date: firstString(entry.date, entry.day) ?? fallbackDate,
    requests: firstNumber(entry.requests, entry.request_count, entry.requestCount) ?? 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      firstNumber(entry.total_tokens, entry.totalTokens) ??
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: firstNumber(entry.cost) ?? 0,
    actualCost: firstNumber(entry.actual_cost, entry.actualCost, entry.cost) ?? 0,
  } satisfies DailyUsage;
}

function parseSubscriptionLimits(payload: Record<string, unknown>) {
  const subscription = asRecord(payload.subscription);
  if (!subscription) return [];

  return [
    {
      window: "daily",
      limit: firstNumber(subscription.daily_limit_usd, subscription.dailyLimitUsd) ?? 0,
      used: firstNumber(subscription.daily_usage_usd, subscription.dailyUsageUsd) ?? 0,
    },
    {
      window: "weekly",
      limit: firstNumber(subscription.weekly_limit_usd, subscription.weeklyLimitUsd) ?? 0,
      used: firstNumber(subscription.weekly_usage_usd, subscription.weeklyUsageUsd) ?? 0,
    },
    {
      window: "monthly",
      limit: firstNumber(subscription.monthly_limit_usd, subscription.monthlyLimitUsd) ?? 0,
      used: firstNumber(subscription.monthly_usage_usd, subscription.monthlyUsageUsd) ?? 0,
    },
  ]
    .filter((entry) => entry.limit > 0)
    .map((entry): RateLimit => ({
      ...entry,
      remaining: Math.max(0, entry.limit - entry.used),
      resetAt: "",
    }));
}

function parseQuotaAmount(payload: Record<string, unknown>) {
  const quota = asRecord(payload.quota);
  if (!quota) return undefined;
  const limit = firstNumber(quota.limit);
  if (limit === undefined || limit <= 0) return undefined;
  const used = firstNumber(quota.used) ?? 0;
  return {
    limit,
    used,
    remaining: firstNumber(quota.remaining) ?? Math.max(0, limit - used),
    unit: firstString(quota.unit, payload.unit) ?? "USD",
  } satisfies QuotaAmount;
}

function getLatestDailyUsage(dailyUsage: DailyUsage[]) {
  return dailyUsage.reduce<DailyUsage | undefined>((latest, current) => {
    if (!latest || current.date > latest.date) return current;
    return latest;
  }, undefined);
}

function parseQuotaInfo(value: unknown, usageUrl: string): QuotaInfo | undefined {
  const payload = selectQuotaPayload(value);
  if (!payload) return undefined;

  const rateLimits = parseRateLimits(payload);
  const subscriptionLimits = parseSubscriptionLimits(payload);
  const dailyUsage = parseDailyUsage(payload);
  const latestDay = getLatestDailyUsage(dailyUsage);
  const usage = asRecord(payload.usage);
  const today = asRecord(usage?.today);
  const total = asRecord(usage?.total);
  const todayUsage = today ? parseUsageEntry(today, "today") : undefined;
  const todayCost =
    firstNumber(
      today?.actual_cost,
      today?.actualCost,
      today?.cost,
      payload.today_cost,
      payload.todayCost,
      todayUsage?.actualCost,
      latestDay?.actualCost,
      latestDay?.cost,
    ) ?? 0;
  const totalCost =
    firstNumber(
      total?.actual_cost,
      total?.actualCost,
      total?.cost,
      payload.total_cost,
      payload.totalCost,
    ) ?? dailyUsage.reduce((sum, day) => sum + day.actualCost, 0);

  return {
    usageUrl,
    rateLimits,
    subscriptionLimits,
    dailyUsage,
    todayUsage,
    quota: parseQuotaAmount(payload),
    todayCost,
    totalCost,
    planName: firstString(payload.planName, payload.plan_name),
    remaining: firstFiniteNumber(payload.remaining),
    unit: firstString(payload.unit),
    expiresAt: firstString(payload.expires_at, payload.expiresAt),
    status:
      firstString(payload.status) ??
      (payload.isValid === true || payload.is_valid === true ? "valid" : "unknown"),
    mode: firstString(payload.mode) ?? "unknown",
    lastUpdated: Date.now(),
  };
}

function getUsageUrls(relay: RelayConfig) {
  return [...new Set([`${relay.anthropicBaseUrl}/usage`, `${relay.baseUrl}/usage`])];
}

function getBillingUrl(relay: RelayConfig) {
  return `${relay.baseUrl}/sub2api/billing`;
}

function parseBillingInfo(value: unknown, billingUrl: string): BillingInfo | undefined {
  const payload = asRecord(value);
  if (!payload || firstString(payload.object) !== "sub2api.key_billing") return undefined;
  const schemaVersion = toPositiveInteger(payload.schema_version ?? payload.schemaVersion);
  const billingScope = firstString(payload.billing_scope, payload.billingScope);
  const groupRateMultiplier = firstStrictNonNegativeNumber(
    payload.group_rate_multiplier,
    payload.groupRateMultiplier,
  );
  const resolvedRateMultiplier = firstStrictNonNegativeNumber(
    payload.resolved_rate_multiplier,
    payload.resolvedRateMultiplier,
  );
  const effectiveRateMultiplier = firstStrictNonNegativeNumber(
    payload.effective_rate_multiplier,
    payload.effectiveRateMultiplier,
  );
  const peakRateEnabled = payload.peak_rate_enabled ?? payload.peakRateEnabled;
  if (
    schemaVersion !== 1 ||
    billingScope !== "token" ||
    groupRateMultiplier === undefined ||
    resolvedRateMultiplier === undefined ||
    effectiveRateMultiplier === undefined ||
    typeof peakRateEnabled !== "boolean"
  ) {
    return undefined;
  }

  return {
    billingUrl,
    schemaVersion,
    billingScope,
    groupRateMultiplier,
    userRateMultiplier: firstStrictNonNegativeNumber(
      payload.user_rate_multiplier,
      payload.userRateMultiplier,
    ),
    resolvedRateMultiplier,
    peakRateEnabled,
    peakStart: firstString(payload.peak_start, payload.peakStart),
    peakEnd: firstString(payload.peak_end, payload.peakEnd),
    peakRateMultiplier: firstStrictNonNegativeNumber(
      payload.peak_rate_multiplier,
      payload.peakRateMultiplier,
    ),
    appliedPeakMultiplier: firstStrictNonNegativeNumber(
      payload.applied_peak_multiplier,
      payload.appliedPeakMultiplier,
    ),
    effectiveRateMultiplier,
    timezone: firstString(payload.timezone),
    observedAt: firstString(payload.observed_at, payload.observedAt),
    lastUpdated: Date.now(),
  };
}

async function fetchBilling(
  relay: RelayConfig,
  signal: AbortSignal,
): Promise<BillingRefreshResult> {
  const billingUrl = getBillingUrl(relay);
  const result = await fetchTextWithRetry(billingUrl, {
    headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
    signal,
  });
  if (!result) return { kind: "temporary", detail: "network request failed" };
  const { response } = result;
  if (response.status === 404 || response.status === 405) {
    discardResponse(response);
    return { kind: "not-found" };
  }
  if (response.status === 401 || response.status === 403) {
    discardResponse(response);
    return { kind: "auth", status: response.status };
  }
  if (!response.ok) {
    discardResponse(response);
    return { kind: "temporary", detail: `HTTP ${response.status}` };
  }
  if ("bodyError" in result) {
    return isRetryableError(result.bodyError)
      ? { kind: "temporary", detail: "response body failed" }
      : { kind: "invalid" };
  }
  if (!("text" in result)) return { kind: "invalid" };

  try {
    if (/<!doctype|<html/i.test(result.text)) return { kind: "invalid" };
    const info = parseBillingInfo(JSON.parse(result.text) as unknown, billingUrl);
    return info ? { kind: "ok", info } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function refreshBilling(relay: RelayConfig, signal: AbortSignal, canCommit: () => boolean) {
  const pending = billingRefreshes.get(relay.provider);
  if (pending) return pending;

  const promise = fetchBilling(relay, signal)
    .then((result) => {
      if (!canCommit()) {
        return result.kind === "ok"
          ? ({ kind: "temporary", detail: "request cancelled" } as const)
          : result;
      }
      if (result.kind === "ok") {
        billingByProvider.set(relay.provider, result.info);
      } else if (["not-found", "auth", "invalid"].includes(result.kind)) {
        billingByProvider.delete(relay.provider);
      }
      return result;
    })
    .catch((): BillingRefreshResult => ({
      kind: "temporary",
      detail: "network request failed",
    }))
    .finally(() => {
      if (billingRefreshes.get(relay.provider) === promise) {
        billingRefreshes.delete(relay.provider);
      }
    });
  billingRefreshes.set(relay.provider, promise);
  return promise;
}

async function fetchQuotaAt(
  relay: RelayConfig,
  usageUrl: string,
  signal: AbortSignal,
): Promise<QuotaRefreshResult> {
  const result = await fetchTextWithRetry(
    usageUrl,
    {
      headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
      signal,
    },
    USAGE_REQUEST_TIMEOUT_MS,
  );
  if (!result) return { kind: "temporary", detail: "network request failed" };
  const { response } = result;
  if (response.status === 404 || response.status === 405) {
    discardResponse(response);
    return { kind: "not-found" };
  }
  if (response.status === 401 || response.status === 403) {
    discardResponse(response);
    return { kind: "auth", status: response.status };
  }
  if (!response.ok) {
    discardResponse(response);
    return { kind: "temporary", detail: `HTTP ${response.status}` };
  }
  if ("bodyError" in result) {
    return isRetryableError(result.bodyError)
      ? { kind: "temporary", detail: "response body failed" }
      : { kind: "invalid" };
  }
  if (!("text" in result)) return { kind: "invalid" };

  try {
    if (/<!doctype|<html/i.test(result.text)) return { kind: "invalid" };
    const info = parseQuotaInfo(JSON.parse(result.text) as unknown, usageUrl);
    return info ? { kind: "ok", info } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

async function refreshQuotaFromNetwork(
  relay: RelayConfig,
  signal: AbortSignal,
  canCommit: () => boolean,
): Promise<QuotaRefreshResult> {
  const knownUrl = quotaByProvider.get(relay.provider)?.usageUrl;
  const candidates = [knownUrl, ...getUsageUrls(relay)].filter(
    (url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index,
  );
  const failures: QuotaRefreshResult[] = [];
  for (const usageUrl of candidates) {
    const result = await fetchQuotaAt(relay, usageUrl, signal);
    if (result.kind !== "ok") {
      failures.push(result);
      continue;
    }
    if (!canCommit()) return { kind: "temporary", detail: "request cancelled" };
    quotaByProvider.set(relay.provider, result.info);
    return result;
  }
  return (
    failures.find((result) => result.kind === "auth") ??
    failures.find((result) => result.kind === "temporary") ??
    failures.find((result) => result.kind === "invalid") ?? { kind: "not-found" }
  );
}

function refreshQuota(relay: RelayConfig, signal: AbortSignal, canCommit: () => boolean) {
  const pending = quotaRefreshes.get(relay.provider);
  if (pending) return pending;

  const promise = refreshQuotaFromNetwork(relay, signal, canCommit)
    .catch((): QuotaRefreshResult => ({ kind: "temporary", detail: "network request failed" }))
    .finally(() => {
      if (quotaRefreshes.get(relay.provider) === promise) quotaRefreshes.delete(relay.provider);
    });
  quotaRefreshes.set(relay.provider, promise);
  return promise;
}

function normalizeWindowLabel(window: string) {
  const value = window.toLowerCase();
  if (value === "1d" || value === "day" || value === "daily") return "daily";
  if (value === "7d" || value === "week" || value === "weekly") return "weekly";
  if (value === "30d" || value === "month" || value === "monthly") return "monthly";
  return value || "default";
}

function shortWindowLabel(window: string) {
  const label = normalizeWindowLabel(window);
  if (label === "daily") return "d";
  if (label === "weekly") return "w";
  if (label === "monthly") return "m";
  return label;
}

function formatMoney(value: number, fractionDigits = 2) {
  return `$${value.toFixed(fractionDigits)}`;
}

function formatCompactTokens(value: number) {
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

function pickQuotaWindows(rateLimits: RateLimit[]) {
  const byLabel = new Map(
    rateLimits.map((rateLimit) => [normalizeWindowLabel(rateLimit.window), rateLimit]),
  );
  const preferred = ["5h", "daily", "weekly"].flatMap((label) => {
    const rateLimit = byLabel.get(label);
    return rateLimit ? [rateLimit] : [];
  });
  return preferred.length ? preferred : rateLimits;
}

function formatQuotaStatus(provider: string, info: QuotaInfo) {
  const heading = provider;
  const windows = (
    info.subscriptionLimits.length ? info.subscriptionLimits : pickQuotaWindows(info.rateLimits)
  ).filter((rateLimit) => rateLimit.limit > 0);
  if (windows.length) {
    const percentages = windows.map((rateLimit) => {
      const percent = Math.round((rateLimit.used / rateLimit.limit) * 100);
      return `${shortWindowLabel(rateLimit.window)} ${percent}%`;
    });
    return sanitizeDisplayString(`${heading} · ${percentages.join(" · ")}`, 200);
  }
  const latestUsage = info.todayUsage ?? getLatestDailyUsage(info.dailyUsage);
  const usageParts = [`d ${formatMoney(info.todayCost)}`];
  if (latestUsage?.totalTokens) {
    usageParts.push(`${formatCompactTokens(latestUsage.totalTokens)} tok`);
  }
  return sanitizeDisplayString(`${heading} · ${usageParts.join(" · ")}`, 200);
}

type FooterTheme = ExtensionContext["ui"]["theme"];
type UsageFooterColor = "accent" | "dim";

interface UsageFooterLine {
  text: string;
  color: UsageFooterColor;
}

interface FooterUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function formatFooterTokens(value: number) {
  if (value < 1_000) return value.toString();
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

function addFooterUsage(totals: FooterUsageTotals, value: unknown) {
  const usage = asRecord(value);
  if (!usage) return;
  totals.input += firstNumber(usage.input) ?? 0;
  totals.output += firstNumber(usage.output) ?? 0;
  totals.cacheRead += firstNumber(usage.cacheRead) ?? 0;
  totals.cacheWrite += firstNumber(usage.cacheWrite) ?? 0;
  totals.cost += firstNumber(asRecord(usage.cost)?.total) ?? 0;
}

function collectFooterUsage(ctx: ExtensionContext) {
  const totals: FooterUsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  for (const entry of ctx.sessionManager.getEntries()) {
    const record = asRecord(entry);
    if (record?.type === "message") {
      const message = asRecord(record.message);
      if (message?.role === "assistant" || message?.role === "toolResult") {
        addFooterUsage(totals, message.usage);
      }
    } else if (record?.type === "branch_summary" || record?.type === "compaction") {
      addFooterUsage(totals, record.usage);
    }
  }
  return totals;
}

function formatFooterCwd(cwd: string, home: string) {
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeFooterStatus(text: string) {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function renderFooterStats(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  width: number,
) {
  const totals = collectFooterUsage(ctx);
  const parts: string[] = [];
  if (totals.input) parts.push(`↑${formatFooterTokens(totals.input)}`);
  if (totals.output) parts.push(`↓${formatFooterTokens(totals.output)}`);
  if (totals.cacheRead) parts.push(`R${formatFooterTokens(totals.cacheRead)}`);
  if (totals.cacheWrite) parts.push(`W${formatFooterTokens(totals.cacheWrite)}`);
  if (totals.cost || ctx.model?.provider === "kimi-coding") {
    parts.push(
      `$${totals.cost.toFixed(3)}${ctx.model?.provider === "kimi-coding" ? " (sub)" : ""}`,
    );
  }

  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const contextPercent = contextUsage?.percent;
  parts.push(
    contextPercent === null || contextPercent === undefined
      ? `?/${formatFooterTokens(contextWindow)}`
      : `${contextPercent.toFixed(1)}%/${formatFooterTokens(contextWindow)}`,
  );

  const left = parts.join(" ");
  const modelName = ctx.model?.id ?? "no-model";
  const modelWithThinking = ctx.model?.reasoning
    ? `${modelName} • ${ctx.thinkingLevel === "off" ? "thinking off" : ctx.thinkingLevel}`
    : modelName;
  let right = modelWithThinking;
  if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
    const withProvider = `(${ctx.model.provider}) ${modelWithThinking}`;
    if (visibleWidth(left) + 2 + visibleWidth(withProvider) <= width) right = withProvider;
  }

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + 2 + rightWidth <= width) {
    return `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
  }
  const availableForRight = width - leftWidth - 2;
  if (availableForRight <= 0) return truncateToWidth(left, width, "...");
  const truncatedRight = truncateToWidth(right, availableForRight, "");
  return `${left}${" ".repeat(Math.max(1, width - leftWidth - visibleWidth(truncatedRight)))}${truncatedRight}`;
}

function renderUsageFooter(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  theme: FooterTheme,
  usageLine: UsageFooterLine | undefined,
  ultraEnabled: boolean,
  fastEnabled: boolean,
  width: number,
) {
  let cwd = formatFooterCwd(ctx.cwd, homedir());
  const branch = footerData.getGitBranch();
  if (branch) cwd += ` (${branch})`;
  const sessionName = ctx.sessionManager.getSessionName();
  if (sessionName) cwd += ` • ${sessionName}`;

  const lines = [
    theme.fg("dim", truncateToWidth(cwd, width, "...")),
    theme.fg("dim", renderFooterStats(ctx, footerData, width)),
  ];
  const otherStatuses = [...footerData.getExtensionStatuses().entries()]
    .filter(([key]) => key !== USAGE_FOOTER_KEY)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeFooterStatus(text));
  if (otherStatuses.length) {
    lines.push(truncateToWidth(otherStatuses.join(" "), width, theme.fg("dim", "...")));
  }
  if (usageLine) {
    let text = ultraEnabled ? `${usageLine.text} [ULTRA ENABLED]` : usageLine.text;
    if (fastEnabled) text += " [FAST]";
    lines.push(theme.fg(usageLine.color, truncateToWidth(text, width, "...")));
  }
  return lines;
}

function refreshActiveQuota(
  ctx: ExtensionContext,
  provider: string,
  refresh: (relay: RelayConfig) => Promise<QuotaRefreshResult>,
  refreshBillingInfo: (relay: RelayConfig) => Promise<BillingRefreshResult>,
  isCurrent: () => boolean,
  setUsageLine: (
    ctx: ExtensionContext,
    provider: string,
    text: string,
    color?: UsageFooterColor,
  ) => void,
  clearUsageLine: (ctx: ExtensionContext) => void,
) {
  if (!ctx.hasUI || !isCurrent()) return;
  const relay = relaysByProvider.get(provider);
  if (!relay) {
    clearUsageLine(ctx);
    return;
  }

  const cached = quotaByProvider.get(provider);
  if (cached) setUsageLine(ctx, provider, formatQuotaStatus(provider, cached));
  else setUsageLine(ctx, provider, `${provider} · loading…`, "dim");
  void refreshBillingInfo(relay).then(() => {
    const latest = quotaByProvider.get(provider);
    if (isCurrent() && latest) {
      setUsageLine(ctx, provider, formatQuotaStatus(provider, latest));
    }
  });
  void refresh(relay).then((result) => {
    if (!isCurrent()) return;
    if (result.kind === "ok") {
      setUsageLine(ctx, provider, formatQuotaStatus(provider, result.info));
    } else if (!quotaByProvider.has(provider)) {
      setUsageLine(ctx, provider, `${provider} · usage unavailable`, "dim");
    }
  });
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

  const generation = ++activeExtensionGeneration;
  const lifecycleController = new AbortController();
  let active = true;
  const isCurrent = () =>
    active && generation === activeExtensionGeneration && !lifecycleController.signal.aborted;

  let usageFooterLine: UsageFooterLine | undefined;
  let requestFooterRender: (() => void) | undefined;
  let ultraEnabled = false;
  let fastEnabled = false;
  const setUsageLine = (
    ctx: ExtensionContext,
    provider: string,
    text: string,
    color: UsageFooterColor = "accent",
  ) => {
    if (!ctx.hasUI || ctx.model?.provider !== provider) return;
    usageFooterLine = { text: sanitizeDisplayString(text, 200), color };
    requestFooterRender?.();
  };
  const clearUsageLine = (_ctx: ExtensionContext) => {
    usageFooterLine = undefined;
    requestFooterRender?.();
  };
  const installUsageFooter = (ctx: ExtensionContext) => {
    // OMP's UI context may lack pi's footer API; skip the quota footer there.
    if (!ctx.hasUI || typeof ctx.ui.setFooter !== "function") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      if (
        typeof footerData.onBranchChange !== "function" ||
        typeof footerData.getGitBranch !== "function" ||
        typeof footerData.getExtensionStatuses !== "function"
      ) {
        return { dispose() {}, invalidate() {}, render: (_width: number) => [] };
      }
      const requestRender = () => tui.requestRender();
      requestFooterRender = requestRender;
      const unsubscribe = footerData.onBranchChange(requestRender);
      return {
        dispose() {
          unsubscribe();
          if (requestFooterRender === requestRender) requestFooterRender = undefined;
        },
        invalidate() {},
        render: (width: number) =>
          renderUsageFooter(
            ctx,
            footerData,
            theme,
            usageFooterLine,
            ultraEnabled,
            fastEnabled,
            width,
          ),
      };
    });
  };

  relaysByProvider.clear();
  quotaByProvider.clear();
  billingByProvider.clear();
  quotaRefreshes.clear();
  billingRefreshes.clear();
  for (const relay of relays) relaysByProvider.set(relay.provider, relay);
  const refreshRelayQuota = (relay: RelayConfig) =>
    refreshQuota(
      relay,
      lifecycleController.signal,
      () => isCurrent() && relaysByProvider.get(relay.provider) === relay,
    );
  const refreshRelayBilling = (relay: RelayConfig) =>
    refreshBilling(
      relay,
      lifecycleController.signal,
      () => isCurrent() && relaysByProvider.get(relay.provider) === relay,
    );

  registerCodexCompaction(pi, (provider) => relaysByProvider.get(provider));

  const [providers, cachedModelMetadata] = await Promise.all([
    Promise.all(
      relays.map(async (relay) => {
        const [models] = await Promise.all([fetchModels(relay), refreshRelayBilling(relay)]);
        return { relay, models };
      }),
    ),
    loadCachedModelMetadata(),
  ]);

  const discoveredModelsByProvider = new Map(
    providers.map(({ relay, models }) => [relay.provider, models]),
  );
  const registeredPriceMultipliers = new Map<string, number>();
  const registerRelayProvider = (relay: RelayConfig, models: DiscoveredModel[]) => {
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const api = getModelApi(model.id, relay.api);
        const reasoning = model.reasoning ?? REASONING.test(model.id);
        const builtinMetadata = getBuiltinModelMetadata(model.id, api, cachedModelMetadata);
        // Keep Anthropic's relay-safe limits: pi's native catalog can advertise a
        // larger output cap than some Sub2API deployments accept. Its pricing is
        // still authoritative when available.
        const builtinLimits = api === "anthropic-messages" ? undefined : builtinMetadata;
        const contextWindow = model.contextWindow ?? builtinLimits?.contextWindow ?? 200000;
        const defaultMaxTokens = Math.min(getDefaultMaxTokens(model.id), contextWindow);
        const maxTokens =
          firstMaxTokensWithinContext(contextWindow, model.maxTokens, builtinLimits?.maxTokens) ??
          defaultMaxTokens;
        return {
          id: model.id,
          name: model.name,
          api,
          baseUrl: getApiBaseUrl(relay, api),
          reasoning,
          thinkingLevelMap: getThinkingLevelMap(
            reasoning,
            api,
            model.supportedThinkingLevels,
            ultraEnabled,
          ),
          input: model.input ?? ["text", "image"],
          cost: scaleModelCost(builtinMetadata?.cost, priceMultiplier),
          contextWindow,
          maxTokens,
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
    registeredPriceMultipliers.set(relay.provider, priceMultiplier);
  };

  for (const { relay, models } of providers) {
    registerRelayProvider(relay, models);
  }

  pi.registerCommand("toggle-ultra", {
    description: "Toggle upstream ultra reasoning for max thinking requests",
    handler: async (_args, ctx) => {
      ultraEnabled = !ultraEnabled;
      for (const { relay, models } of providers) {
        registerRelayProvider(relay, models);
      }
      pi.setThinkingLevel("max");
      requestFooterRender?.();
      ctx.ui.notify(ultraEnabled ? "Ultra reasoning enabled" : "Ultra reasoning disabled", "info");
    },
  });

  pi.registerCommand("toggle-fast", {
    description: "Toggle OpenAI priority service tier for faster responses",
    handler: async (_args, ctx) => {
      fastEnabled = !fastEnabled;
      requestFooterRender?.();
      ctx.ui.notify(fastEnabled ? "Fast mode enabled" : "Fast mode disabled", "info");
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    return addServerTools(event.payload, ctx.model);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastEnabled) return;
    return addFastServiceTier(event.payload, ctx.model);
  });

  const syncRelayProviderPricing = (relay: RelayConfig) => {
    if (!isCurrent()) return;
    const models = discoveredModelsByProvider.get(relay.provider);
    if (!models) return;
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    if (registeredPriceMultipliers.get(relay.provider) === priceMultiplier) return;
    registerRelayProvider(relay, models);
  };
  const refreshRelayBillingAndPricing = async (relay: RelayConfig) => {
    const result = await refreshRelayBilling(relay);
    syncRelayProviderPricing(relay);
    return result;
  };

  pi.on("session_start", (_event, ctx) => {
    installUsageFooter(ctx);
    if (ctx.model) {
      refreshActiveQuota(
        ctx,
        ctx.model.provider,
        refreshRelayQuota,
        refreshRelayBillingAndPricing,
        isCurrent,
        setUsageLine,
        clearUsageLine,
      );
    } else clearUsageLine(ctx);
  });

  pi.on("model_select", (event, ctx) => {
    refreshActiveQuota(
      ctx,
      event.model.provider,
      refreshRelayQuota,
      refreshRelayBillingAndPricing,
      isCurrent,
      setUsageLine,
      clearUsageLine,
    );
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model) {
      refreshActiveQuota(
        ctx,
        ctx.model.provider,
        refreshRelayQuota,
        refreshRelayBillingAndPricing,
        isCurrent,
        setUsageLine,
        clearUsageLine,
      );
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    lifecycleController.abort();
    clearUsageLine(ctx);
  });
}
