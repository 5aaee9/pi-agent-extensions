import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILENAME = "custom-provider.json";
export const DEFAULT_CACHE_FILENAME = "custom-provider-models.json";
export const DEFAULT_CACHE_TTL_SECONDS = 60 * 60;
export const MODELS_DEV_DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_MODELS_URL = "https://models.dev/models.json";
export const REQUEST_TIMEOUT_MS = 5_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MODELS_DEV_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_MODEL_TOKEN_LIMIT = 10_000_000;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 16_384;
export const ESCAPED_DOLLAR_PLACEHOLDER = "__PI_CUSTOM_PROVIDER_ESCAPED_DOLLAR__";

export const SUPPORTED_APIS = [
  "openai-completions",
  "anthropic-messages",
  "openai-responses",
  "ollama-chat",
] as const;
export type SupportedApi = (typeof SUPPORTED_APIS)[number];

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export type JsonRecord = Record<string, unknown>;

export interface CacheOptions {
  enabled: boolean;
  ttlSeconds: number;
  file?: string;
}

export interface ModelsDevOptions {
  enabled: boolean;
  ttlSeconds: number;
  file?: string;
  apiURL: string;
  modelsURL: string;
}

export interface ModelsDevCatalog {
  providers: JsonRecord;
  models: JsonRecord;
}

export interface ModelsDevCache extends ModelsDevCatalog {
  fetchedAt: number;
  cacheKey?: string;
}

export interface ProviderDefinition {
  name: string;
  baseURL: string;
  openaiBaseURL: string;
  anthropicBaseURL: string;
  ollamaBaseURL: string;
  api: SupportedApi;
  apiKey?: string;
  headers: Record<string, string>;
  modelsURL: string;
  authHeader: "authorization" | "x-api-key";
  useAuthorizationHeader: boolean;
  modelsDevProvider?: string;
  useModelsDev: boolean;
  compat?: JsonRecord;
  modelOverrides: Record<string, JsonRecord>;
  modelDefaults?: JsonRecord;
  fallbackModels: DiscoveredModel[];
  reasoningPattern?: RegExp;
  sessionAffinityHeader?: string;
  cache: CacheOptions;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  nameProvided: boolean;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ProviderModelConfig["cost"];
  costProvided: boolean;
  costFields?: {
    input: boolean;
    output: boolean;
    cacheRead: boolean;
    cacheWrite: boolean;
  };
  reasoningProvided: boolean;
  inputProvided: boolean;
  thinkingLevelMapProvided: boolean;
  compat?: JsonRecord;
}

export interface CachedProviderModels {
  cacheKey: string;
  fetchedAt: number;
  models: DiscoveredModel[];
}

export interface CacheDocument {
  version: 1;
  providers: Record<string, CachedProviderModels>;
  modelsDev?: ModelsDevCache;
}

export interface RootConfig {
  providers: Record<string, unknown>;
  cache: Partial<CacheOptions>;
  modelsDev: ModelsDevOptions;
}
