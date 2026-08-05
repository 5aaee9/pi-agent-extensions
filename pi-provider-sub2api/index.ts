import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILENAME = "sub2api.json";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_TOKEN_LIMIT = 10_000_000;
const QUOTA_STATUS_KEY = "sub2api-quota";
const CODEX_API = openAICodexResponsesApi();
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

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

interface QuotaInfo {
  usageUrl: string;
  rateLimits: RateLimit[];
  dailyUsage: DailyUsage[];
  todayCost: number;
  totalCost: number;
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

const relaysByProvider = new Map<string, RelayConfig>();
const quotaByProvider = new Map<string, QuotaInfo>();
const quotaRefreshes = new Map<string, Promise<QuotaRefreshResult>>();
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

  const entry = value as { baseURL?: unknown; token?: unknown; api?: unknown };
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

  const { baseUrl, anthropicBaseUrl } = normalizeBaseUrls(entry.baseURL);
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey: entry.token,
    api: entry.api as SupportedApi | undefined,
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
): Promise<TextFetchResult | null> {
  const canRetry = (init.method ?? "GET").toUpperCase() === "GET";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (init.signal?.aborted) return null;
    let shouldRetry = false;
    try {
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
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
  if (configuredApi) return configuredApi;
  if (CLAUDE.test(modelId)) return "anthropic-messages";
  // OpenAI models use pi's Codex adapter for its Codex-shaped requests; the
  // relay fetch rewrites them to the standard /v1/responses endpoint.
  if (OPENAI.test(modelId)) return "openai-codex-responses";
  return "openai-responses";
}

function getApiBaseUrl(relay: RelayConfig, api: SupportedApi) {
  return api === "anthropic-messages" ? relay.anthropicBaseUrl : relay.baseUrl;
}

function getThinkingLevelMap(modelId: string, api: SupportedApi) {
  if (!REASONING.test(modelId)) return undefined;
  if (api === "anthropic-messages") return { xhigh: "max" };
  // Relayed Codex backends reject the "none" and "minimal" efforts with
  // upstream 5xx errors, so clamp minimal to low. The Codex adapter omits the
  // reasoning field entirely when thinking is off, while the plain Responses
  // adapter requires off to be unselectable (null) to do the same.
  return api === "openai-codex-responses"
    ? { off: "none", minimal: "low", xhigh: "xhigh" }
    : { off: null, minimal: "low", xhigh: "xhigh" };
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function pickRemoteContextWindow(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return toPositiveInteger(
    model.context_window ??
      model.contextWindow ??
      model.context_length ??
      model.max_context_tokens ??
      limit?.context ??
      limits?.context,
  );
}

function pickRemoteMaxTokens(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return toPositiveInteger(
    model.max_tokens ??
      model.maxTokens ??
      model.max_output_tokens ??
      model.max_completion_tokens ??
      limit?.output ??
      limits?.output,
  );
}

async function fetchModels(relay: RelayConfig): Promise<DiscoveredModel[]> {
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
        };
      });
  } catch (error) {
    console.error(`[sub2api:${relay.provider}] failed to fetch models:`, error);
    return [];
  }
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const sanitized = sanitizeDisplayString(value);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function hasQuotaFields(value: Record<string, unknown>) {
  return ["rate_limits", "rateLimits", "daily_usage", "dailyUsage", "usage"].some(
    (key) => key in value,
  );
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
    const inputTokens = firstNumber(entry.input_tokens, entry.inputTokens) ?? 0;
    const outputTokens = firstNumber(entry.output_tokens, entry.outputTokens) ?? 0;
    const cacheReadTokens = firstNumber(entry.cache_read_tokens, entry.cacheReadTokens) ?? 0;
    const cacheWriteTokens = firstNumber(entry.cache_write_tokens, entry.cacheWriteTokens) ?? 0;
    return [
      {
        date: firstString(entry.date, entry.day) ?? "",
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
      },
    ];
  });
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
  const dailyUsage = parseDailyUsage(payload);
  const latestDay = getLatestDailyUsage(dailyUsage);
  const usage = asRecord(payload.usage);
  const today = asRecord(usage?.today);
  const total = asRecord(usage?.total);
  const todayCost =
    firstNumber(
      today?.actual_cost,
      today?.actualCost,
      today?.cost,
      payload.today_cost,
      payload.todayCost,
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
    dailyUsage,
    todayCost,
    totalCost,
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

async function fetchQuotaAt(
  relay: RelayConfig,
  usageUrl: string,
  signal: AbortSignal,
): Promise<QuotaRefreshResult> {
  const result = await fetchTextWithRetry(usageUrl, {
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
  return value || "default";
}

function shortWindowLabel(window: string) {
  const label = normalizeWindowLabel(window);
  if (label === "daily") return "d";
  if (label === "weekly") return "w";
  return label;
}

function formatMoney(value: number, fractionDigits = 2) {
  return `$${value.toFixed(fractionDigits)}`;
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
  const windows = pickQuotaWindows(info.rateLimits).filter((rateLimit) => rateLimit.limit > 0);
  if (windows.length) {
    const percentages = windows.map((rateLimit) => {
      const percent = Math.round((rateLimit.used / rateLimit.limit) * 100);
      return `${shortWindowLabel(rateLimit.window)} ${percent}%`;
    });
    return sanitizeDisplayString(`● ${provider} ${percentages.join(" · ")}`, 200);
  }
  return sanitizeDisplayString(`● ${provider} d ${formatMoney(info.todayCost)}`, 200);
}

function setQuotaStatus(ctx: ExtensionContext, provider: string, info: QuotaInfo) {
  if (!ctx.hasUI || ctx.model?.provider !== provider) return;
  ctx.ui.setStatus(QUOTA_STATUS_KEY, ctx.ui.theme.fg("accent", formatQuotaStatus(provider, info)));
}

function refreshActiveQuota(
  ctx: ExtensionContext,
  provider: string,
  refresh: (relay: RelayConfig) => Promise<QuotaRefreshResult>,
  isCurrent: () => boolean,
) {
  if (!ctx.hasUI || !isCurrent()) return;
  const relay = relaysByProvider.get(provider);
  if (!relay) {
    ctx.ui.setStatus(QUOTA_STATUS_KEY, undefined);
    return;
  }

  const cached = quotaByProvider.get(provider);
  if (cached) setQuotaStatus(ctx, provider, cached);
  else ctx.ui.setStatus(QUOTA_STATUS_KEY, undefined);
  void refresh(relay).then((result) => {
    if (isCurrent() && result.kind === "ok") setQuotaStatus(ctx, provider, result.info);
  });
}

function formatQuotaReport(provider: string, info: QuotaInfo) {
  const latestDay = getLatestDailyUsage(info.dailyUsage);
  const lines = [
    `Sub2API quota — ${provider}`,
    `Status: ${info.status}`,
    `Mode: ${info.mode}`,
    `Today cost: ${formatMoney(info.todayCost, 4)}`,
    `Total cost: ${formatMoney(info.totalCost, 4)}`,
    `Updated: ${new Date(info.lastUpdated).toLocaleString()}`,
  ];

  if (latestDay) {
    lines.push(
      `Daily usage (${latestDay.date || "latest"}): ${latestDay.requests.toLocaleString()} requests, ${latestDay.totalTokens.toLocaleString()} tokens`,
      `  input ${latestDay.inputTokens.toLocaleString()} · output ${latestDay.outputTokens.toLocaleString()} · cache read ${latestDay.cacheReadTokens.toLocaleString()} · cache write ${latestDay.cacheWriteTokens.toLocaleString()}`,
    );
  }

  lines.push("Rate limits:");
  if (!info.rateLimits.length) lines.push("  none reported by provider");
  for (const rateLimit of info.rateLimits) {
    const reset = rateLimit.resetAt ? new Date(rateLimit.resetAt).toLocaleString() : "unknown";
    lines.push(
      `  ${normalizeWindowLabel(rateLimit.window)}: ${formatMoney(rateLimit.used)}/${formatMoney(rateLimit.limit)} (remaining ${formatMoney(rateLimit.remaining)}, resets ${reset})`,
    );
  }
  return lines.join("\n");
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

  relaysByProvider.clear();
  quotaByProvider.clear();
  quotaRefreshes.clear();
  for (const relay of relays) relaysByProvider.set(relay.provider, relay);
  const refreshRelayQuota = (relay: RelayConfig) =>
    refreshQuota(
      relay,
      lifecycleController.signal,
      () => isCurrent() && relaysByProvider.get(relay.provider) === relay,
    );

  const providers = await Promise.all(
    relays.map(async (relay) => ({ relay, models: await fetchModels(relay) })),
  );

  for (const { relay, models } of providers) {
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const api = getModelApi(model.id, relay.api);
        const contextWindow = model.contextWindow ?? 200000;
        const defaultMaxTokens = Math.min(getDefaultMaxTokens(model.id), contextWindow);
        const maxTokens =
          model.maxTokens !== undefined && model.maxTokens <= contextWindow
            ? model.maxTokens
            : defaultMaxTokens;
        return {
          id: model.id,
          name: model.name,
          api,
          baseUrl: getApiBaseUrl(relay, api),
          reasoning: REASONING.test(model.id),
          thinkingLevelMap: getThinkingLevelMap(model.id, api),
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.model) refreshActiveQuota(ctx, ctx.model.provider, refreshRelayQuota, isCurrent);
    else if (ctx.hasUI) ctx.ui.setStatus(QUOTA_STATUS_KEY, undefined);
  });

  pi.on("model_select", (event, ctx) => {
    refreshActiveQuota(ctx, event.model.provider, refreshRelayQuota, isCurrent);
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model) refreshActiveQuota(ctx, ctx.model.provider, refreshRelayQuota, isCurrent);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    lifecycleController.abort();
    if (ctx.hasUI) ctx.ui.setStatus(QUOTA_STATUS_KEY, undefined);
  });

  pi.registerCommand("quota", {
    description: "Show detailed Sub2API quota for the active provider",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || !isCurrent()) return;
      const provider = ctx.model?.provider;
      if (!provider) {
        if (ctx.hasUI) ctx.ui.notify("No active model selected.", "error");
        return;
      }

      const relay = relaysByProvider.get(provider);
      if (!relay) {
        const label = sanitizeDisplayString(provider, 128) || "unknown";
        ctx.ui.notify(`Provider '${label}' is not managed by Sub2API.`, "warning");
        return;
      }

      const result = await refreshRelayQuota(relay);
      if (!isCurrent()) return;
      if (result.kind === "ok") {
        setQuotaStatus(ctx, provider, result.info);
        ctx.ui.notify(formatQuotaReport(provider, result.info), "info");
        return;
      }

      const cached = quotaByProvider.get(provider);
      if (cached) {
        setQuotaStatus(ctx, provider, cached);
        ctx.ui.notify(
          `Quota refresh failed; showing cached data.\n\n${formatQuotaReport(provider, cached)}`,
          "warning",
        );
        return;
      }

      if (result.kind === "auth") {
        ctx.ui.notify(`Quota endpoint rejected the relay token (HTTP ${result.status}).`, "error");
      } else if (result.kind === "temporary") {
        ctx.ui.notify(`Quota endpoint is temporarily unavailable: ${result.detail}.`, "warning");
      } else if (result.kind === "invalid") {
        ctx.ui.notify("Quota endpoint returned an unsupported response.", "warning");
      } else {
        ctx.ui.notify(
          `Provider '${provider}' has no usable /usage or /v1/usage endpoint.`,
          "warning",
        );
      }
    },
  });
}
