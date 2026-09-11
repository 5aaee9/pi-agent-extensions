import type { ModelCost } from "@earendil-works/pi-ai";

export const CONFIG_FILENAME = "sub2api.json";
export const REQUEST_TIMEOUT_MS = 5_000;
export const USAGE_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MODEL_TOKEN_LIMIT = 10_000_000;
export const USAGE_FOOTER_KEY = "sub2api-usage";

export const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

// Models that are not chat / reasoning models (e.g. image generators).
export const EXCLUDED = /^gpt-image/i;
export const CLAUDE = /^claude-/i;
export const OPENAI = /^(?:chatgpt(?:-|$)|codex(?:-|$)|gpt(?:-|$)|o\d(?:-|$))/i;

// Models that support extended thinking / reasoning.
export const REASONING = /(claude|codex|gpt-[56])/i;

// Claude 4.6+ uses adaptive thinking instead of token-budget thinking.
export const ADAPTIVE_CLAUDE =
  /^claude-(?:fable-5|(?:haiku|opus|sonnet)-(?:4-[6-9]|[5-9]))(?:-|$)/i;

export const SUPPORTED_APIS = [
  "anthropic-messages",
  "openai-codex-responses",
  "openai-responses",
  "openai-completions",
] as const;
export type SupportedApi = (typeof SUPPORTED_APIS)[number];
export const FAST_MODE_APIS = new Set<SupportedApi>([
  "openai-codex-responses",
  "openai-responses",
  "openai-completions",
]);

export type ServerToolDefinition = Record<string, unknown>;

export interface RelayServerTools {
  responses: ServerToolDefinition[];
  anthropic: ServerToolDefinition[];
}

export const SERVER_TOOL_GROUPS = ["responses", "anthropic"] as const;
export type ServerToolGroup = (typeof SERVER_TOOL_GROUPS)[number];
export const RESPONSES_SERVER_TOOL_API: Partial<Record<SupportedApi, true>> = {
  "openai-codex-responses": true,
  "openai-responses": true,
};

export interface RelayConfig {
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

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  supportedThinkingLevels?: string[];
  reasoning?: boolean;
  input?: ("text" | "image")[];
}

export interface ModelTokenLimits {
  contextWindow?: number;
  maxTokens?: number;
}

export interface BuiltinModelMetadata extends ModelTokenLimits {
  cost: ModelCost;
}

export type ModelMetadataCatalogs = Map<string, Map<string, BuiltinModelMetadata>>;

export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  window: string;
  resetAt: string;
}

export interface DailyUsage {
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

export interface QuotaAmount {
  limit: number;
  used: number;
  remaining: number;
  unit: string;
}

export interface BillingInfo {
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

export interface QuotaInfo {
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

export type QuotaRefreshResult =
  | { kind: "ok"; info: QuotaInfo }
  | { kind: "not-found" }
  | { kind: "auth"; status: number }
  | { kind: "temporary"; detail: string }
  | { kind: "invalid" };

export type BillingRefreshResult =
  | { kind: "ok"; info: BillingInfo }
  | { kind: "not-found" }
  | { kind: "auth"; status: number }
  | { kind: "temporary"; detail: string }
  | { kind: "invalid" };

// Shared extension state: populated when providers register, read by streaming
// and quota code paths. The extension entry point clears all of these on load.
export const relaysByProvider = new Map<string, RelayConfig>();
export const quotaByProvider = new Map<string, QuotaInfo>();
export const billingByProvider = new Map<string, BillingInfo>();
export const quotaRefreshes = new Map<string, Promise<QuotaRefreshResult>>();
export const billingRefreshes = new Map<string, Promise<BillingRefreshResult>>();

const generationState = { activeExtensionGeneration: 0 };
export function nextExtensionGeneration() {
  generationState.activeExtensionGeneration += 1;
  return generationState.activeExtensionGeneration;
}
export function isExtensionGeneration(generation: number) {
  return generation === generationState.activeExtensionGeneration;
}
