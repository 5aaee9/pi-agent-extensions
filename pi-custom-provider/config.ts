import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { parseDiscoveredModel } from "./model-metadata.ts";
import {
  CONFIG_FILENAME,
  DEFAULT_CACHE_TTL_SECONDS,
  ESCAPED_DOLLAR_PLACEHOLDER,
  MODELS_DEV_API_URL,
  MODELS_DEV_DEFAULT_CACHE_TTL_SECONDS,
  MODELS_DEV_MODELS_URL,
  SUPPORTED_APIS,
} from "./types.ts";
import type {
  CacheOptions,
  DiscoveredModel,
  ModelsDevOptions,
  ProviderDefinition,
  RootConfig,
  SupportedApi,
} from "./types.ts";
import { asRecord, firstNonNegativeNumber, hasControlCharacters, isSafeModelId } from "./util.ts";

export function parseApi(value: unknown): SupportedApi {
  if (value === undefined) return "openai-completions";
  if (typeof value !== "string") throw new Error("api must be a string");
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, SupportedApi> = {
    "openai-completions": "openai-completions",
    "openai-chat-compatible": "openai-completions",
    "openai-chat": "openai-completions",
    "chat-completions": "openai-completions",
    openai: "openai-completions",
    anthropic: "anthropic-messages",
    "anthropic-messages": "anthropic-messages",
    responses: "openai-responses",
    "openai-responses": "openai-responses",
    ollama: "ollama-chat",
    "ollama-chat": "ollama-chat",
    "ollama-chat-api": "ollama-chat",
  };
  const api = aliases[normalized];
  if (!api) {
    throw new Error(
      `unsupported api ${JSON.stringify(value)}; expected ${SUPPORTED_APIS.join(", ")}`,
    );
  }
  return api;
}

export function normalizeBaseUrls(value: string) {
  const configured = value.trim();
  if (!configured || hasControlCharacters(value)) throw new Error("baseURL must be a valid URL");
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`invalid baseURL ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseURL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("baseURL must not include credentials, query, or fragment");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const hasV1Suffix = pathname.endsWith("/v1");
  const makeURL = (nextPath: string) => {
    const url = new URL(parsed);
    url.pathname = nextPath || "/";
    return url.toString().replace(/\/$/, "");
  };
  return {
    openaiBaseURL: makeURL(hasV1Suffix ? pathname : `${pathname}/v1`),
    anthropicBaseURL: makeURL(hasV1Suffix ? pathname.slice(0, -3) : pathname),
    ollamaBaseURL: makeURL(hasV1Suffix ? pathname.slice(0, -3) : pathname),
  };
}

export function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

export function expandPath(value: string, baseDir: string) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : join(baseDir, value);
}

export function getConfigPath() {
  return join(getAgentDir(), CONFIG_FILENAME);
}

export function isConfigExpression(value: string) {
  return value.startsWith("!") || /\$(?:[A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})/.test(value);
}

export function escapeProviderLiteral(value: string) {
  const escaped = value.replace(/\$/g, "$$$$");
  return escaped.startsWith("!") ? `$!${escaped.slice(1)}` : escaped;
}

export function toProviderValue(value: string) {
  return isConfigExpression(value) ? value : escapeProviderLiteral(value);
}

export function resolveConfigValue(value: string | undefined) {
  if (!value || value.startsWith("!")) return value?.startsWith("!") ? undefined : value;
  return value
    .replace(/\$\$/g, ESCAPED_DOLLAR_PLACEHOLDER)
    .replace(/\$!/g, "!")
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_match, braced, bare) => {
      return process.env[braced ?? bare] ?? "";
    })
    .replaceAll(ESCAPED_DOLLAR_PLACEHOLDER, "$");
}

export function parseCacheOptions(value: unknown, defaults: Partial<CacheOptions>): CacheOptions {
  if (value === false) return { enabled: false, ttlSeconds: 0 };
  const record = asRecord(value);
  const ttl = firstNonNegativeNumber(
    record?.ttlSeconds,
    record?.ttl_seconds,
    record?.ttl,
    defaults.ttlSeconds,
  );
  return {
    enabled: record?.enabled !== false && defaults.enabled !== false,
    ttlSeconds: ttl ?? DEFAULT_CACHE_TTL_SECONDS,
    file: typeof record?.file === "string" ? record.file : defaults.file,
  };
}

export function defaultModelsDevOptions(): ModelsDevOptions {
  return {
    enabled: true,
    ttlSeconds: MODELS_DEV_DEFAULT_CACHE_TTL_SECONDS,
    apiURL: MODELS_DEV_API_URL,
    modelsURL: MODELS_DEV_MODELS_URL,
  };
}

export function parseModelsDevOptions(
  value: unknown,
  cacheDefaults: Partial<CacheOptions>,
): ModelsDevOptions {
  if (value === false) return { ...defaultModelsDevOptions(), enabled: false };
  const record = asRecord(value);
  const defaults = defaultModelsDevOptions();
  return {
    enabled: record?.enabled !== false,
    ttlSeconds:
      firstNonNegativeNumber(record?.ttlSeconds, record?.ttl_seconds, record?.ttl) ??
      defaults.ttlSeconds,
    file:
      typeof record?.file === "string"
        ? record.file
        : typeof record?.cacheFile === "string"
          ? record.cacheFile
          : cacheDefaults.file,
    apiURL:
      typeof record?.apiURL === "string" && record.apiURL.trim()
        ? record.apiURL
        : typeof record?.apiUrl === "string" && record.apiUrl.trim()
          ? record.apiUrl
          : defaults.apiURL,
    modelsURL:
      typeof record?.modelsURL === "string" && record.modelsURL.trim()
        ? record.modelsURL
        : typeof record?.modelsUrl === "string" && record.modelsUrl.trim()
          ? record.modelsUrl
          : defaults.modelsURL,
  };
}

function parseModelOverrides(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([id, override]) => {
      const parsed = asRecord(override);
      return isSafeModelId(id) && parsed ? [[id, structuredClone(parsed)]] : [];
    }),
  );
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function parseReasoningPattern(name: string, value: unknown): RegExp | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`provider ${name} reasoningPattern must be a non-empty string`);
  }
  try {
    return new RegExp(value, "i");
  } catch (error) {
    throw new Error(
      `provider ${name} reasoningPattern is not a valid regex: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSessionAffinityHeader(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  const header = value === true ? "x-session-id" : typeof value === "string" ? value.trim() : "";
  if (!header || !HEADER_NAME_RE.test(header)) {
    throw new Error(`provider ${name} sessionAffinityHeader must be a valid HTTP header name`);
  }
  return header;
}

function parseFallbackModels(name: string, value: unknown, api: SupportedApi): DiscoveredModel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`provider ${name} fallbackModels must be an array`);
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const entry of value.slice(0, 1000)) {
    const record = asRecord(entry);
    if (!record) continue;
    const model = parseDiscoveredModel(record, api);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

export function parseProvider(
  name: string,
  value: unknown,
  defaults: Partial<CacheOptions>,
): ProviderDefinition {
  if (!name.trim() || name !== name.trim() || hasControlCharacters(name)) {
    throw new Error(`invalid provider name ${JSON.stringify(name)}`);
  }
  const record = asRecord(value);
  if (!record) throw new Error(`provider ${name} must be an object`);
  const baseURL = record.baseURL ?? record.baseUrl;
  if (typeof baseURL !== "string" || !baseURL.trim()) {
    throw new Error(`provider ${name} is missing baseURL`);
  }
  const { openaiBaseURL, anthropicBaseURL, ollamaBaseURL } = normalizeBaseUrls(baseURL);
  const api = parseApi(record.api);
  // The endpoint family that serves the configured API: Ollama lives at the
  // raw base URL (no /v1), Anthropic strips it, OpenAI-compatible adds it.
  const requestBaseURL =
    api === "anthropic-messages"
      ? anthropicBaseURL
      : api === "ollama-chat"
        ? ollamaBaseURL
        : openaiBaseURL;
  const apiKeyValue = record.apiKey ?? record.api_key ?? record.token;
  if (apiKeyValue !== undefined && typeof apiKeyValue !== "string") {
    throw new Error(`provider ${name} apiKey must be a string`);
  }
  const headersRecord = asRecord(record.headers);
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(headersRecord ?? {})) {
    if (typeof headerValue === "string") headers[key] = headerValue;
  }
  const modelsValue =
    record.modelsURL ?? record.modelsUrl ?? record.models_url ?? record.modelsPath;
  const modelsURL =
    typeof modelsValue === "string" && modelsValue.trim()
      ? new URL(modelsValue, `${requestBaseURL}/`).toString()
      : api === "ollama-chat"
        ? `${ollamaBaseURL}/api/tags`
        : `${openaiBaseURL}/models`;
  const authHeader =
    record.authHeader === "authorization"
      ? "authorization"
      : record.authHeader === "x-api-key" || api === "anthropic-messages"
        ? "x-api-key"
        : "authorization";
  const providerCompat = asRecord(record.compat);
  return {
    name,
    baseURL,
    openaiBaseURL,
    anthropicBaseURL,
    ollamaBaseURL,
    api,
    apiKey: apiKeyValue,
    headers,
    modelsURL,
    authHeader,
    useAuthorizationHeader: record.authHeader === "authorization",
    modelsDevProvider:
      typeof record.modelsDevProvider === "string" && record.modelsDevProvider.trim()
        ? record.modelsDevProvider.trim()
        : undefined,
    useModelsDev: record.modelsDev !== false,
    compat: providerCompat ? structuredClone(providerCompat) : undefined,
    modelOverrides: parseModelOverrides(record.modelOverrides ?? record.model_overrides),
    modelDefaults: asRecord(record.modelDefaults ?? record.model_defaults)
      ? structuredClone(asRecord(record.modelDefaults ?? record.model_defaults))
      : undefined,
    fallbackModels: parseFallbackModels(name, record.fallbackModels ?? record.fallback_models, api),
    reasoningPattern: parseReasoningPattern(
      name,
      record.reasoningPattern ?? record.reasoning_pattern,
    ),
    sessionAffinityHeader: parseSessionAffinityHeader(
      name,
      record.sessionAffinityHeader ?? record.session_affinity_header,
    ),
    cache: parseCacheOptions(record.cache, {
      ...defaults,
      enabled: record.cache !== false && defaults.enabled !== false,
      ttlSeconds:
        firstNonNegativeNumber(
          record.cacheTTLSeconds,
          record.cacheTtlSeconds,
          record.cache_ttl_seconds,
          defaults.ttlSeconds,
        ) ?? DEFAULT_CACHE_TTL_SECONDS,
    }),
  };
}

export function parseRootConfig(value: unknown): RootConfig {
  const record = asRecord(value);
  if (!record) throw new Error("top-level value must be an object");
  const providersRecord = asRecord(record.providers);
  const providers = providersRecord ?? record;
  const defaultsRecord = asRecord(record.cache);
  const defaults: Partial<CacheOptions> = {
    enabled: defaultsRecord?.enabled !== false,
    ttlSeconds: firstNonNegativeNumber(
      record.cacheTTLSeconds,
      record.cacheTtlSeconds,
      defaultsRecord?.ttlSeconds,
      defaultsRecord?.ttl_seconds,
    ),
    file:
      typeof record.cacheFile === "string"
        ? record.cacheFile
        : typeof defaultsRecord?.file === "string"
          ? defaultsRecord.file
          : undefined,
  };
  const filtered = Object.fromEntries(
    Object.entries(providers).filter(
      ([key]) =>
        ![
          "providers",
          "cache",
          "cacheFile",
          "cacheTTLSeconds",
          "cacheTtlSeconds",
          "modelsDev",
        ].includes(key),
    ),
  );
  return {
    providers: filtered,
    cache: defaults,
    modelsDev: parseModelsDevOptions(record.modelsDev, defaults),
  };
}

export async function loadConfig(path: string): Promise<RootConfig> {
  try {
    const text = await readFile(path, "utf8");
    return parseRootConfig(JSON.parse(text) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { providers: {}, cache: {}, modelsDev: defaultModelsDevOptions() };
    }
    throw error;
  }
}

export async function loadProviders(configPath: string) {
  const root = await loadConfig(configPath);
  const providers = Object.entries(root.providers).map(([name, value]) =>
    parseProvider(name, value, root.cache),
  );
  return { root, providers };
}
