import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILENAME = "custom-provider.json";
const DEFAULT_CACHE_FILENAME = "custom-provider-models.json";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60;
const MODELS_DEV_DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_MODELS_URL = "https://models.dev/models.json";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODELS_DEV_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_MODEL_TOKEN_LIMIT = 10_000_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const ESCAPED_DOLLAR_PLACEHOLDER = "__PI_CUSTOM_PROVIDER_ESCAPED_DOLLAR__";

const SUPPORTED_APIS = ["openai-completions", "anthropic-messages", "openai-responses"] as const;
type SupportedApi = (typeof SUPPORTED_APIS)[number];

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

type JsonRecord = Record<string, unknown>;

interface CacheOptions {
  enabled: boolean;
  ttlSeconds: number;
  file?: string;
}

interface ModelsDevOptions {
  enabled: boolean;
  ttlSeconds: number;
  file?: string;
  apiURL: string;
  modelsURL: string;
}

interface ModelsDevCatalog {
  providers: JsonRecord;
  models: JsonRecord;
}

interface ModelsDevCache extends ModelsDevCatalog {
  fetchedAt: number;
  cacheKey?: string;
}

interface ProviderDefinition {
  name: string;
  baseURL: string;
  openaiBaseURL: string;
  anthropicBaseURL: string;
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
  cache: CacheOptions;
}

interface DiscoveredModel {
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

interface CachedProviderModels {
  cacheKey: string;
  fetchedAt: number;
  models: DiscoveredModel[];
}

interface CacheDocument {
  version: 1;
  providers: Record<string, CachedProviderModels>;
  modelsDev?: ModelsDevCache;
}

interface RootConfig {
  providers: Record<string, unknown>;
  cache: Partial<CacheOptions>;
  modelsDev: ModelsDevOptions;
}

const THINKING_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_ALIASES: Record<string, ThinkingLevel> = {
  min: "minimal",
  minimum: "minimal",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  med: "medium",
  high: "high",
  xhigh: "xhigh",
  "x-high": "xhigh",
  "very-high": "xhigh",
  very_high: "xhigh",
  max: "max",
  maximum: "max",
  ultra: "max",
};

const MODEL_VARIANT_SUFFIXES = [
  "none-priority",
  "low-priority",
  "medium-priority",
  "high-priority",
  "xhigh-priority",
  "max-priority",
  "low-fast",
  "medium-fast",
  "high-fast",
  "xhigh-fast",
  "max-fast",
  "thinking-1m",
  "thinking",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "minimal",
] as const;

function variantKey(uid: string): string | null {
  for (const suffix of MODEL_VARIANT_SUFFIXES) {
    if (uid === suffix || uid.endsWith(`-${suffix}`)) return suffix;
  }
  return null;
}

function thinkingFromSuffix(suffix: string | null): ThinkingLevel | null {
  if (!suffix) return "high";
  if (suffix === "none" || suffix === "none-priority") return "off";
  if (suffix === "minimal") return "minimal";
  if (suffix.startsWith("low")) return "low";
  if (suffix.startsWith("medium")) return "medium";
  if (suffix.startsWith("high") && !suffix.startsWith("xhigh")) return "high";
  if (suffix.startsWith("xhigh")) return "xhigh";
  if (suffix.startsWith("max")) return "max";
  if (suffix.includes("thinking")) return "high";
  return null;
}

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} satisfies ProviderModelConfig["cost"];

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function hasControlCharacters(value: string) {
  return [...value].some(isControlCharacter);
}

function sanitizeDisplayString(value: string, maxLength = 256) {
  return [...value]
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

function toNonNegativeNumber(value: unknown) {
  const parsed =
    typeof value === "number" || (typeof value === "string" && value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function firstNonNegativeNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNonNegativeNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function pickContextWindow(model: JsonRecord) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  const context = asRecord(model.context);
  return firstPositiveInteger(
    model.context_window,
    model.contextWindow,
    model.context_length,
    model.max_context_tokens,
    model.maxContextTokens,
    limit?.context,
    limits?.context,
    context?.window,
    context?.length,
  );
}

function pickMaxTokens(model: JsonRecord) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return firstPositiveInteger(
    model.max_tokens,
    model.maxTokens,
    model.max_output_tokens,
    model.maxOutputTokens,
    model.max_completion_tokens,
    model.maxCompletionTokens,
    limit?.output,
    limits?.output,
  );
}

function normalizeThinkingName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function extractThinkingValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
      const record = asRecord(entry);
      if (!record) return [];
      for (const key of ["effort", "level", "name", "value", "id"]) {
        if (typeof record[key] === "string" && record[key].trim()) return [record[key].trim()];
      }
      return [];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["levels", "efforts", "supported", "supported_levels", "supportedLevels"]) {
    const values = extractThinkingValues(record[key]);
    if (values.length > 0) return values;
  }
  return Object.entries(record)
    .filter(
      ([key, entry]) =>
        entry === true && THINKING_ALIASES[normalizeThinkingName(key)] !== undefined,
    )
    .map(([key]) => key);
}

function pickThinkingValues(model: JsonRecord) {
  const capabilities = asRecord(model.capabilities);
  const reasoning = asRecord(model.reasoning);
  const thinking = asRecord(model.thinking);
  const candidates = [
    model.supported_reasoning_levels,
    model.supportedReasoningLevels,
    model.reasoning_levels,
    model.reasoningLevels,
    model.thinking_levels,
    model.thinkingLevels,
    model.reasoning_effort,
    model.reasoningEffort,
    capabilities?.supported_reasoning_levels,
    capabilities?.supportedReasoningLevels,
    capabilities?.reasoning_levels,
    capabilities?.reasoningLevels,
    capabilities?.reasoning_effort,
    capabilities?.reasoningEffort,
    reasoning?.levels,
    reasoning?.efforts,
    reasoning?.supported,
    reasoning?.supported_levels,
    reasoning?.effort,
    thinking?.levels,
    thinking?.efforts,
    thinking?.supported,
    thinking?.supported_levels,
    thinking?.effort,
  ];
  for (const candidate of candidates) {
    const values = extractThinkingValues(candidate);
    if (values.length > 0) return values;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["enabled", "supported", "available", "value"]) {
    if (typeof record[key] === "boolean") return record[key];
  }
  if (typeof record.type === "string") {
    const type = record.type.toLowerCase();
    if (["disabled", "off", "none"].includes(type)) return false;
    if (["enabled", "adaptive", "budget"].includes(type)) return true;
  }
  return undefined;
}

function hasReasoningMetadata(model: JsonRecord, thinkingValues: string[] | undefined) {
  const capabilities = asRecord(model.capabilities);
  const supportedParameters = [model.supported_parameters, capabilities?.supported_parameters]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === "string")
    .some((parameter) =>
      ["reasoning", "reasoning_effort", "reasoning_content", "thinking", "enable_thinking"].some(
        (name) => parameter.toLowerCase().includes(name),
      ),
    );
  const fields = [
    model.reasoning,
    model.supports_reasoning,
    model.supportsReasoning,
    model.thinking,
    model.supports_thinking,
    model.supportsThinking,
    capabilities?.reasoning,
    capabilities?.supports_reasoning,
    capabilities?.supportsReasoning,
    capabilities?.thinking,
    capabilities?.supports_thinking,
    capabilities?.supportsThinking,
  ];
  return (
    fields.some((value) => value !== undefined) ||
    supportedParameters ||
    thinkingValues !== undefined
  );
}

function pickReasoning(model: JsonRecord, thinkingValues: string[] | undefined) {
  const capabilities = asRecord(model.capabilities);
  const supportedParameters = [model.supported_parameters, capabilities?.supported_parameters]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  for (const value of [
    model.reasoning,
    model.supports_reasoning,
    model.supportsReasoning,
    model.thinking,
    model.supports_thinking,
    model.supportsThinking,
    capabilities?.reasoning,
    capabilities?.supports_reasoning,
    capabilities?.supportsReasoning,
    capabilities?.thinking,
    capabilities?.supports_thinking,
    capabilities?.supportsThinking,
  ]) {
    const result = readBoolean(value);
    if (result !== undefined) return result;
  }

  if (
    supportedParameters.some((parameter) =>
      ["reasoning", "reasoning_effort", "reasoning_content", "thinking", "enable_thinking"].some(
        (name) => parameter.includes(name),
      ),
    )
  ) {
    return true;
  }

  return (
    thinkingValues?.some(
      (value) => !["none", "off", "disabled"].includes(normalizeThinkingName(value)),
    ) ?? false
  );
}

function readExplicitThinkingMap(model: JsonRecord): ThinkingLevelMap | undefined {
  const candidate =
    model.thinkingLevelMap ?? model.thinking_level_map ?? model.reasoning_effort_map;
  const record = asRecord(candidate);
  if (!record) return undefined;
  const result: ThinkingLevelMap = {};
  for (const level of ["off", ...THINKING_LEVELS] as ThinkingLevel[]) {
    const value = record[level];
    if (value === null || typeof value === "string") result[level] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mapThinkingLevels(
  api: SupportedApi,
  reasoning: boolean,
  values: string[] | undefined,
  explicitMap?: ThinkingLevelMap,
): ThinkingLevelMap | undefined {
  if (!reasoning) return undefined;
  if (explicitMap) return explicitMap;

  const normalizedValues = new Map<string, string>();
  for (const value of values ?? []) {
    const normalized = normalizeThinkingName(value);
    if (!normalizedValues.has(normalized)) normalizedValues.set(normalized, value);
  }

  // Without an upstream capability list, only make the disabled state explicit.
  // This prevents Responses from sending an invented `none` effort by default.
  if (normalizedValues.size === 0) return { off: null };

  const off = ["none", "off", "disabled"].find((name) => normalizedValues.has(name));
  const map: ThinkingLevelMap = { off: off ? normalizedValues.get(off)! : null };
  const has = (level: ThinkingLevel) => {
    for (const [alias, mapped] of Object.entries(THINKING_ALIASES)) {
      if (mapped === level && normalizedValues.has(alias)) return normalizedValues.get(alias);
    }
    return undefined;
  };

  for (const level of THINKING_LEVELS) {
    const exact = has(level);
    if (exact) {
      map[level] = exact;
      continue;
    }
    // A provider advertising only `low` normally uses it for Pi's minimal level.
    if (level === "minimal" && normalizedValues.has("low"))
      map[level] = normalizedValues.get("low");
    else if (level === "max" && normalizedValues.has("ultra")) {
      map[level] = normalizedValues.get("ultra");
    } else {
      map[level] = null;
    }
  }

  // Anthropic's non-adaptive API uses a token budget rather than effort strings;
  // retain the map only when upstream actually supplied adaptive effort metadata.
  if (api === "anthropic-messages" && values === undefined) return undefined;
  return map;
}

function hasInputMetadata(model: JsonRecord) {
  const architecture = asRecord(model.architecture);
  const capabilities = asRecord(model.capabilities);
  return [
    model.input_modalities,
    model.inputModalities,
    model.modalities,
    asRecord(model.modalities)?.input,
    architecture?.input_modalities,
    architecture?.inputModalities,
    capabilities?.input_modalities,
    capabilities?.inputModalities,
  ].some((value) => Array.isArray(value));
}

function pickInputTypes(model: JsonRecord) {
  const architecture = asRecord(model.architecture);
  const capabilities = asRecord(model.capabilities);
  const raw = [
    model.input_modalities,
    model.inputModalities,
    model.modalities,
    asRecord(model.modalities)?.input,
    architecture?.input_modalities,
    architecture?.inputModalities,
    capabilities?.input_modalities,
    capabilities?.inputModalities,
  ].find((value) => Array.isArray(value));
  const modalities = Array.isArray(raw)
    ? raw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase())
    : [];
  if (
    modalities.some((modality) =>
      ["image", "vision", "multimodal", "image_url"].some((name) => modality.includes(name)),
    )
  ) {
    return ["text", "image"] as ("text" | "image")[];
  }
  return ["text"] as ("text" | "image")[];
}

function pickCost(model: JsonRecord): {
  cost: ProviderModelConfig["cost"];
  provided: boolean;
  fields: NonNullable<DiscoveredModel["costFields"]>;
} {
  const cost = asRecord(model.cost);
  const pricing = asRecord(model.pricing);
  const source = cost ?? pricing;
  if (!source) {
    return {
      cost: { ...ZERO_COST },
      provided: false,
      fields: { input: false, output: false, cacheRead: false, cacheWrite: false },
    };
  }

  const directInput = firstNonNegativeNumber(
    source.input,
    source.input_cost,
    source.inputCost,
    source.input_per_million_tokens,
    source.inputPerMillionTokens,
  );
  const directOutput = firstNonNegativeNumber(
    source.output,
    source.output_cost,
    source.outputCost,
    source.output_per_million_tokens,
    source.outputPerMillionTokens,
    source.reasoning,
  );
  const prompt = firstNonNegativeNumber(source.prompt, source.prompt_cost, source.promptCost);
  const completion = firstNonNegativeNumber(
    source.completion,
    source.completion_cost,
    source.completionCost,
  );
  // OpenRouter and several gateways publish prompt/completion rates per token.
  const usesPerTokenRates = prompt !== undefined || completion !== undefined;
  const input = directInput ?? (usesPerTokenRates ? (prompt ?? 0) * 1_000_000 : 0);
  const output = directOutput ?? (usesPerTokenRates ? (completion ?? 0) * 1_000_000 : 0);
  const cacheRead =
    firstNonNegativeNumber(
      source.cacheRead,
      source.cache_read,
      source.cache_read_cost,
      source.cacheReadCost,
      source.cache_read_per_million_tokens,
    ) ?? 0;
  const cacheWrite =
    firstNonNegativeNumber(
      source.cacheWrite,
      source.cache_write,
      source.cache_write_cost,
      source.cacheWriteCost,
      source.cache_write_per_million_tokens,
    ) ?? 0;
  const fields = {
    input: directInput !== undefined || prompt !== undefined,
    output: directOutput !== undefined || completion !== undefined,
    cacheRead:
      firstNonNegativeNumber(
        source.cacheRead,
        source.cache_read,
        source.cache_read_cost,
        source.cacheReadCost,
        source.cache_read_per_million_tokens,
      ) !== undefined,
    cacheWrite:
      firstNonNegativeNumber(
        source.cacheWrite,
        source.cache_write,
        source.cache_write_cost,
        source.cacheWriteCost,
        source.cache_write_per_million_tokens,
      ) !== undefined,
  };
  return {
    cost: { input, output, cacheRead, cacheWrite },
    provided: Object.values(fields).some(Boolean),
    fields,
  };
}

function pickCompat(model: JsonRecord, api: SupportedApi): JsonRecord | undefined {
  const configured = asRecord(model.compat);
  const capabilities = asRecord(model.capabilities);
  const result: JsonRecord = configured ? structuredClone(configured) : {};
  const copyBoolean = (name: string, ...keys: string[]) => {
    if (result[name] !== undefined) return;
    for (const key of keys) {
      if (typeof model[key] === "boolean") {
        result[name] = model[key];
        return;
      }
      if (typeof capabilities?.[key] === "boolean") {
        result[name] = capabilities[key];
        return;
      }
    }
  };

  if (api === "anthropic-messages") {
    copyBoolean(
      "forceAdaptiveThinking",
      "forceAdaptiveThinking",
      "adaptive_thinking",
      "adaptiveThinking",
    );
    const thinking = asRecord(model.thinking);
    const reasoning = asRecord(model.reasoning);
    if (
      result.forceAdaptiveThinking === undefined &&
      (thinking?.type === "adaptive" || reasoning?.type === "adaptive")
    ) {
      result.forceAdaptiveThinking = true;
    }
    copyBoolean("supportsStrictTools", "supportsStrictTools", "supports_strict_tools");
  } else {
    copyBoolean("supportsReasoningEffort", "supportsReasoningEffort", "supports_reasoning_effort");
    copyBoolean("supportsDeveloperRole", "supportsDeveloperRole", "supports_developer_role");
    copyBoolean(
      "supportsUsageInStreaming",
      "supportsUsageInStreaming",
      "supports_usage_in_streaming",
    );
    copyBoolean("supportsStrictMode", "supportsStrictMode", "supports_strict_mode");
    if (typeof model.thinkingFormat === "string") result.thinkingFormat = model.thinkingFormat;
    if (typeof model.thinking_format === "string") result.thinkingFormat = model.thinking_format;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseDiscoveredModel(model: JsonRecord, api: SupportedApi): DiscoveredModel | undefined {
  const id = model.id ?? model.slug ?? model.model_id ?? model.modelId ?? model.model;
  if (!isSafeModelId(id)) return undefined;
  const nameValue = model.display_name ?? model.displayName ?? model.name;
  const name =
    typeof nameValue === "string" && sanitizeDisplayString(nameValue)
      ? sanitizeDisplayString(nameValue)
      : id;
  const thinkingValues = pickThinkingValues(model);
  const reasoning = pickReasoning(model, thinkingValues);
  const explicitThinkingMap = readExplicitThinkingMap(model);
  const thinkingLevelMap = mapThinkingLevels(api, reasoning, thinkingValues, explicitThinkingMap);
  const pickedCost = pickCost(model);
  return {
    id,
    name,
    nameProvided: typeof nameValue === "string" && Boolean(sanitizeDisplayString(nameValue)),
    reasoning,
    reasoningProvided: hasReasoningMetadata(model, thinkingValues),
    thinkingLevelMap,
    thinkingLevelMapProvided: thinkingValues !== undefined || explicitThinkingMap !== undefined,
    input: pickInputTypes(model),
    inputProvided: hasInputMetadata(model),
    contextWindow: pickContextWindow(model),
    maxTokens: pickMaxTokens(model),
    cost: pickedCost.cost,
    costProvided: pickedCost.provided,
    costFields: pickedCost.fields,
    compat: pickCompat(model, api),
  };
}

interface ModelsDevLookupCandidate {
  fullId: string;
  modelId: string;
  providerHint?: string;
  suffix: string | null;
}

function modelsDevLookupCandidates(id: string): ModelsDevLookupCandidate[] {
  const candidates: ModelsDevLookupCandidate[] = [];
  const seen = new Set<string>();
  const add = (fullId: string, providerHint?: string) => {
    const suffix = variantKey(fullId);
    const normalized = suffix ? fullId.slice(0, -suffix.length - 1) : fullId;
    const values = [normalized, fullId];
    for (const value of values) {
      const slash = value.indexOf("/");
      const modelId = slash >= 0 ? value.slice(slash + 1) : value;
      const hint = slash >= 0 ? value.slice(0, slash) : providerHint;
      const key = `${hint ?? ""}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ fullId: value, modelId, providerHint: hint, suffix });
    }
  };
  add(id);
  return candidates;
}

function lookupRecord(record: JsonRecord | undefined, id: string) {
  if (!record) return undefined;
  if (asRecord(record[id])) return asRecord(record[id]);
  const lowerId = id.toLowerCase();
  const match = Object.entries(record).find(([key]) => key.toLowerCase() === lowerId);
  return match ? asRecord(match[1]) : undefined;
}

function mergeModelsDevRecords(base: JsonRecord | undefined, override: JsonRecord | undefined) {
  if (!base) return override;
  if (!override) return base;
  const result = { ...base, ...override };
  for (const key of ["cost", "limit", "modalities"]) {
    const baseValue = asRecord(base[key]);
    const overrideValue = asRecord(override[key]);
    if (baseValue || overrideValue) result[key] = { ...baseValue, ...overrideValue };
  }
  return result;
}

function findModelsDevModel(
  provider: ProviderDefinition,
  catalog: ModelsDevCatalog,
  id: string,
): JsonRecord | undefined {
  const candidates = modelsDevLookupCandidates(id);
  const providerIds = [
    provider.modelsDevProvider,
    provider.name,
    ...candidates.map((candidate) => candidate.providerHint),
  ].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );
  const providerRecords = providerIds.flatMap((providerId) => {
    const entry = lookupRecord(catalog.providers, providerId);
    return entry?.models ? [asRecord(entry.models)] : [];
  });
  const allProviderRecords = Object.values(catalog.providers).flatMap((value) => {
    const entry = asRecord(value);
    return entry?.models ? [asRecord(entry.models)] : [];
  });
  for (const candidate of candidates) {
    for (const models of [...providerRecords, ...allProviderRecords]) {
      const found =
        lookupRecord(models, candidate.fullId) ?? lookupRecord(models, candidate.modelId);
      if (found) {
        const modelOnly =
          lookupRecord(catalog.models, candidate.fullId) ??
          lookupRecord(catalog.models, candidate.modelId);
        return mergeModelsDevRecords(modelOnly, found);
      }
    }
    const modelOnly =
      lookupRecord(catalog.models, candidate.fullId) ??
      lookupRecord(catalog.models, candidate.modelId);
    if (modelOnly) return modelOnly;
  }
  return undefined;
}

function modelsDevMetadata(
  record: JsonRecord,
  api: SupportedApi,
  suffix: string | null,
): Partial<DiscoveredModel> {
  const limit = asRecord(record.limit);
  const modalities = asRecord(record.modalities);
  const reasoningOptions = Array.isArray(record.reasoning_options)
    ? record.reasoning_options
    : undefined;
  const effortValues = reasoningOptions?.flatMap((option) => {
    const entry = asRecord(option);
    return entry?.type === "effort" ? extractThinkingValues(entry.values) : [];
  });
  const suffixThinking = thinkingFromSuffix(suffix);
  const reasoningProvided =
    typeof record.reasoning === "boolean" || reasoningOptions !== undefined || suffix !== null;
  const reasoning =
    typeof record.reasoning === "boolean"
      ? record.reasoning
      : reasoningOptions !== undefined || suffixThinking !== null;
  const effectiveEffortValues =
    effortValues && effortValues.length > 0
      ? effortValues
      : suffixThinking && suffixThinking !== "off"
        ? [suffixThinking]
        : undefined;
  const thinkingLevelMap = mapThinkingLevels(api, reasoning, effectiveEffortValues);
  const pickedCost = pickCost(record);
  const inputModalities = Array.isArray(modalities?.input) ? modalities.input : undefined;
  const input = inputModalities
    ? inputModalities.some(
        (value) =>
          typeof value === "string" &&
          ["image", "vision", "multimodal", "image_url"].some((name) => value.includes(name)),
      )
      ? (["text", "image"] as ("text" | "image")[])
      : (["text"] as ("text" | "image")[])
    : undefined;
  const name = typeof record.name === "string" ? sanitizeDisplayString(record.name) : "";
  return {
    name: name || undefined,
    nameProvided: Boolean(name),
    reasoning,
    reasoningProvided,
    thinkingLevelMap,
    thinkingLevelMapProvided: reasoningOptions !== undefined || suffix !== null,
    input,
    inputProvided: input !== undefined,
    contextWindow: firstPositiveInteger(limit?.context),
    maxTokens: firstPositiveInteger(limit?.output),
    cost: pickedCost.cost,
    costProvided: pickedCost.provided,
    costFields: pickedCost.fields,
  };
}

function enrichWithModelsDev(
  provider: ProviderDefinition,
  model: DiscoveredModel,
  catalog: ModelsDevCatalog,
): DiscoveredModel {
  if (!provider.useModelsDev) return model;
  const record = findModelsDevModel(provider, catalog, model.id);
  if (!record) return model;
  const external = modelsDevMetadata(record, provider.api, variantKey(model.id));
  const nameProvided = model.nameProvided ?? model.name !== model.id;
  const upstreamCostFields = model.costFields ?? {
    input: model.cost.input !== 0,
    output: model.cost.output !== 0,
    cacheRead: model.cost.cacheRead !== 0,
    cacheWrite: model.cost.cacheWrite !== 0,
  };
  const costFields = {
    input: upstreamCostFields.input || external.costFields?.input === true,
    output: upstreamCostFields.output || external.costFields?.output === true,
    cacheRead: upstreamCostFields.cacheRead || external.costFields?.cacheRead === true,
    cacheWrite: upstreamCostFields.cacheWrite || external.costFields?.cacheWrite === true,
  };
  return {
    ...model,
    name: nameProvided ? model.name : (external.name ?? model.name),
    nameProvided: nameProvided || external.nameProvided === true,
    contextWindow: model.contextWindow ?? external.contextWindow,
    maxTokens: model.maxTokens ?? external.maxTokens,
    cost: {
      input: upstreamCostFields.input
        ? model.cost.input
        : (external.cost?.input ?? model.cost.input),
      output: upstreamCostFields.output
        ? model.cost.output
        : (external.cost?.output ?? model.cost.output),
      cacheRead: upstreamCostFields.cacheRead
        ? model.cost.cacheRead
        : (external.cost?.cacheRead ?? model.cost.cacheRead),
      cacheWrite: upstreamCostFields.cacheWrite
        ? model.cost.cacheWrite
        : (external.cost?.cacheWrite ?? model.cost.cacheWrite),
    },
    costProvided: Object.values(costFields).some(Boolean),
    costFields,
    reasoning: model.reasoningProvided ? model.reasoning : (external.reasoning ?? model.reasoning),
    reasoningProvided: model.reasoningProvided || external.reasoningProvided === true,
    thinkingLevelMap: model.thinkingLevelMapProvided
      ? model.thinkingLevelMap
      : (external.thinkingLevelMap ?? model.thinkingLevelMap),
    thinkingLevelMapProvided:
      model.thinkingLevelMapProvided || external.thinkingLevelMapProvided === true,
    input: model.inputProvided ? model.input : (external.input ?? model.input),
    inputProvided: model.inputProvided || external.inputProvided === true,
  };
}

function parseApi(value: unknown): SupportedApi {
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
  };
  const api = aliases[normalized];
  if (!api) {
    throw new Error(
      `unsupported api ${JSON.stringify(value)}; expected ${SUPPORTED_APIS.join(", ")}`,
    );
  }
  return api;
}

function normalizeBaseUrls(value: string) {
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
  };
}

function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

function expandPath(value: string, baseDir: string) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : join(baseDir, value);
}

function getConfigPath() {
  return join(getAgentDir(), CONFIG_FILENAME);
}

function isConfigExpression(value: string) {
  return value.startsWith("!") || /\$(?:[A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})/.test(value);
}

function escapeProviderLiteral(value: string) {
  const escaped = value.replace(/\$/g, "$$$$");
  return escaped.startsWith("!") ? `$!${escaped.slice(1)}` : escaped;
}

function toProviderValue(value: string) {
  return isConfigExpression(value) ? value : escapeProviderLiteral(value);
}

function resolveConfigValue(value: string | undefined) {
  if (!value || value.startsWith("!")) return value?.startsWith("!") ? undefined : value;
  return value
    .replace(/\$\$/g, ESCAPED_DOLLAR_PLACEHOLDER)
    .replace(/\$!/g, "!")
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_match, braced, bare) => {
      return process.env[braced ?? bare] ?? "";
    })
    .replaceAll(ESCAPED_DOLLAR_PLACEHOLDER, "$");
}

function parseCacheOptions(value: unknown, defaults: Partial<CacheOptions>): CacheOptions {
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

function defaultModelsDevOptions(): ModelsDevOptions {
  return {
    enabled: true,
    ttlSeconds: MODELS_DEV_DEFAULT_CACHE_TTL_SECONDS,
    apiURL: MODELS_DEV_API_URL,
    modelsURL: MODELS_DEV_MODELS_URL,
  };
}

function parseModelsDevOptions(
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

function parseProvider(
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
  const { openaiBaseURL, anthropicBaseURL } = normalizeBaseUrls(baseURL);
  const api = parseApi(record.api);
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
      ? new URL(modelsValue, `${openaiBaseURL}/`).toString()
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

function parseRootConfig(value: unknown): RootConfig {
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

async function loadConfig(path: string): Promise<RootConfig> {
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

async function readResponseText(response: Response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} bytes`);
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
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function discoveryHeaders(provider: ProviderDefinition) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(provider.headers)) {
    headers[key] = resolveConfigValue(value) ?? value;
  }
  const apiKey = resolveConfigValue(provider.apiKey);
  if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === provider.authHeader)) {
    if (provider.authHeader === "x-api-key") headers["x-api-key"] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
  }
  headers.Accept ??= "application/json";
  if (provider.api === "anthropic-messages") headers["anthropic-version"] ??= "2023-06-01";
  return headers;
}

async function fetchJson(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  maxBytes = MAX_RESPONSE_BYTES,
) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: requestSignal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return JSON.parse(await readResponseText(response, maxBytes)) as unknown;
}

async function fetchModels(provider: ProviderDefinition, signal: AbortSignal) {
  const payload = await fetchJson(
    provider.modelsURL,
    signal,
    discoveryHeaders(provider),
    MAX_RESPONSE_BYTES,
  );
  const root = asRecord(payload);
  const values = Array.isArray(payload) ? payload : (root?.data ?? root?.models);
  if (!Array.isArray(values)) throw new Error("model response must contain a data or models array");
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const model = parseDiscoveredModel(asRecord(value) ?? {}, provider.api);
    if (!model || seen.has(model.id)) return [];
    seen.add(model.id);
    return [model];
  });
}

function cacheKey(provider: ProviderDefinition) {
  return JSON.stringify({
    api: provider.api,
    baseURL: provider.baseURL,
    modelsURL: provider.modelsURL,
  });
}

function emptyCache(): CacheDocument {
  return { version: 1, providers: {} };
}

async function readCache(path: string): Promise<CacheDocument> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const record = asRecord(parsed);
    const providers = asRecord(record?.providers);
    if (record?.version !== 1 || !providers) return emptyCache();
    const modelsDevRecord = asRecord(record?.modelsDev);
    const modelsDevProviders = asRecord(modelsDevRecord?.providers);
    const modelsDevModels = asRecord(modelsDevRecord?.models);
    const modelsDev =
      modelsDevRecord &&
      Number.isFinite(modelsDevRecord.fetchedAt) &&
      modelsDevProviders &&
      modelsDevModels
        ? {
            fetchedAt: modelsDevRecord.fetchedAt as number,
            cacheKey:
              typeof modelsDevRecord.cacheKey === "string" ? modelsDevRecord.cacheKey : undefined,
            providers: modelsDevProviders,
            models: modelsDevModels,
          }
        : undefined;
    return {
      version: 1,
      providers: providers as Record<string, CachedProviderModels>,
      ...(modelsDev ? { modelsDev } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[custom-provider] failed to read cache ${path}:`, error);
    }
    return emptyCache();
  }
}

async function writeCache(path: string, cache: CacheDocument) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function modelsDevCachePath(options: ModelsDevOptions, rootCache: Partial<CacheOptions>) {
  const configured = options.file ?? rootCache.file ?? DEFAULT_CACHE_FILENAME;
  return expandPath(configured, getAgentDir());
}

function emptyModelsDevCatalog(): ModelsDevCatalog {
  return { providers: {}, models: {} };
}

async function loadModelsDevCatalog(
  options: ModelsDevOptions,
  cache: CacheDocument,
  cacheFile: string,
  signal: AbortSignal,
  forceRefresh: boolean,
): Promise<ModelsDevCatalog> {
  if (!options.enabled) return emptyModelsDevCatalog();
  const cached = cache.modelsDev;
  const key = JSON.stringify({ apiURL: options.apiURL, modelsURL: options.modelsURL });
  const cacheUsable =
    cached !== undefined &&
    (cached.cacheKey === undefined || cached.cacheKey === key) &&
    ((Number.isFinite(cached.fetchedAt) && Object.keys(cached.providers).length > 0) ||
      (Number.isFinite(cached.fetchedAt) && Object.keys(cached.models).length > 0));
  if (!forceRefresh && cacheUsable && Date.now() - cached!.fetchedAt <= options.ttlSeconds * 1000) {
    return { providers: cached!.providers, models: cached!.models };
  }

  const [apiResult, modelsResult] = await Promise.allSettled([
    fetchJson(
      options.apiURL,
      signal,
      { Accept: "application/json" },
      MAX_MODELS_DEV_RESPONSE_BYTES,
    ),
    fetchJson(
      options.modelsURL,
      signal,
      { Accept: "application/json" },
      MAX_MODELS_DEV_RESPONSE_BYTES,
    ),
  ]);
  const usableCached = cacheUsable ? cached : undefined;
  const providers =
    apiResult.status === "fulfilled" ? asRecord(apiResult.value) : usableCached?.providers;
  const models =
    modelsResult.status === "fulfilled" ? asRecord(modelsResult.value) : usableCached?.models;
  if (!providers && !models) {
    if (usableCached) {
      console.warn("[custom-provider] models.dev refresh failed; using cached metadata");
      return { providers: usableCached.providers, models: usableCached.models };
    }
    console.warn("[custom-provider] failed to fetch models.dev metadata");
    return emptyModelsDevCatalog();
  }

  const catalog = { providers: providers ?? {}, models: models ?? {} };
  if (options.enabled) {
    cache.modelsDev = { ...catalog, fetchedAt: Date.now(), cacheKey: key };
    try {
      await writeCache(cacheFile, cache);
    } catch (error) {
      console.warn(`[custom-provider] failed to write models.dev cache ${cacheFile}:`, error);
    }
  }
  if (apiResult.status === "rejected" || modelsResult.status === "rejected") {
    console.warn("[custom-provider] models.dev refresh partially failed; using available metadata");
  }
  return catalog;
}

function mergeCompat(...values: (JsonRecord | undefined)[]) {
  const merged = Object.assign({}, ...values.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function applyModelOverride(model: DiscoveredModel, override: JsonRecord | undefined) {
  if (!override) return model;
  const result = { ...model } as DiscoveredModel & JsonRecord;
  for (const key of [
    "name",
    "reasoning",
    "contextWindow",
    "maxTokens",
    "input",
    "cost",
    "thinkingLevelMap",
    "compat",
  ]) {
    if (override[key] !== undefined) (result as JsonRecord)[key] = structuredClone(override[key]);
  }
  result.compat = mergeCompat(model.compat, asRecord(override.compat));
  if (override.name !== undefined) result.nameProvided = true;
  if (override.reasoning !== undefined) result.reasoningProvided = true;
  if (override.thinkingLevelMap !== undefined) result.thinkingLevelMapProvided = true;
  if (override.input !== undefined) result.inputProvided = true;
  if (override.cost !== undefined) {
    result.costProvided = true;
    const cost = asRecord(override.cost);
    if (cost) {
      result.costFields = {
        input: cost.input !== undefined,
        output: cost.output !== undefined,
        cacheRead: cost.cacheRead !== undefined,
        cacheWrite: cost.cacheWrite !== undefined,
      };
    }
  }
  if (typeof result.name !== "string" || !result.name.trim()) result.name = model.name;
  if (typeof result.reasoning !== "boolean") result.reasoning = model.reasoning;
  if (!Array.isArray(result.input)) result.input = model.input;
  if (!asRecord(result.cost)) result.cost = model.cost;
  return result;
}

function modelConfig(
  provider: ProviderDefinition,
  discovered: DiscoveredModel,
): ProviderModelConfig {
  const model = applyModelOverride(discovered, provider.modelOverrides[discovered.id]);
  const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const maxTokens = Math.min(model.maxTokens ?? DEFAULT_MAX_TOKENS, contextWindow);
  const api = provider.api;
  return {
    id: model.id,
    name: model.name,
    api,
    baseUrl: api === "anthropic-messages" ? provider.anthropicBaseURL : provider.openaiBaseURL,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    cost: model.cost,
    contextWindow,
    maxTokens,
    compat: mergeCompat(provider.compat, model.compat) as ProviderModelConfig["compat"],
  };
}

function registeredApiKey(value: string | undefined) {
  return value === undefined ? undefined : toProviderValue(value);
}

function registeredHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, toProviderValue(value)]),
  );
}

function providerConfig(provider: ProviderDefinition, models: DiscoveredModel[]): ProviderConfig {
  const configs = models.map((model) => modelConfig(provider, model));
  const headers = registeredHeaders(provider.headers);
  const hasAuthorizationHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization",
  );
  const usesAuthorizationHeader = provider.useAuthorizationHeader;
  if (usesAuthorizationHeader && provider.apiKey && !hasAuthorizationHeader) {
    headers.Authorization = `Bearer ${toProviderValue(provider.apiKey)}`;
  }
  return {
    name: provider.name,
    baseUrl:
      provider.api === "anthropic-messages" ? provider.anthropicBaseURL : provider.openaiBaseURL,
    // Anthropic's SDK uses x-api-key for apiKey. When a gateway explicitly asks
    // for Authorization, keep the key in the configured header instead so the
    // request does not contain two competing authentication schemes.
    apiKey: usesAuthorizationHeader ? undefined : registeredApiKey(provider.apiKey),
    api: provider.api,
    headers,
    models: configs,
  };
}

function cachePath(provider: ProviderDefinition, rootCache: Partial<CacheOptions>) {
  const configured = provider.cache.file ?? rootCache.file ?? DEFAULT_CACHE_FILENAME;
  return expandPath(configured, getAgentDir());
}

async function discoverProvider(
  provider: ProviderDefinition,
  cache: CacheDocument,
  cacheFile: string,
  signal: AbortSignal,
  forceRefresh: boolean,
) {
  const key = cacheKey(provider);
  const cached = cache.providers[provider.name];
  const cacheUsable =
    provider.cache.enabled &&
    cached?.cacheKey === key &&
    Array.isArray(cached.models) &&
    Number.isFinite(cached.fetchedAt);
  if (
    !forceRefresh &&
    cacheUsable &&
    Date.now() - cached.fetchedAt <= provider.cache.ttlSeconds * 1000
  ) {
    return cached.models;
  }

  try {
    const models = await fetchModels(provider, signal);
    if (provider.cache.enabled) {
      cache.providers[provider.name] = { cacheKey: key, fetchedAt: Date.now(), models };
      await writeCache(cacheFile, cache);
    }
    return models;
  } catch (error) {
    if (cacheUsable) {
      console.warn(
        `[custom-provider:${provider.name}] model discovery failed; using cached models`,
      );
      return cached.models;
    }
    console.error(`[custom-provider:${provider.name}] failed to fetch models:`, error);
    return [];
  }
}

async function loadProviders(configPath: string) {
  const root = await loadConfig(configPath);
  const providers = Object.entries(root.providers).map(([name, value]) =>
    parseProvider(name, value, root.cache),
  );
  return { root, providers };
}

export { mapThinkingLevels, parseDiscoveredModel, parseRootConfig, thinkingFromSuffix, variantKey };

export default async function customProviderExtension(pi: ExtensionAPI) {
  const configPath = getConfigPath();
  let loaded: Awaited<ReturnType<typeof loadProviders>>;
  try {
    loaded = await loadProviders(configPath);
  } catch (error) {
    console.error(`[custom-provider] failed to load ${configPath}:`, error);
    return;
  }
  if (loaded.providers.length === 0) return;

  const controller = new AbortController();
  const cacheDocuments = new Map<string, CacheDocument>();
  const discoveredModels = new Map<string, DiscoveredModel[]>();

  const discoverAll = async (forceRefresh: boolean) => {
    // Process providers serially so providers sharing the default cache file do
    // not overwrite each other's atomic writes with stale in-memory documents.
    const modelsDevPath = modelsDevCachePath(loaded.root.modelsDev, loaded.root.cache);
    let modelsDevCache = cacheDocuments.get(modelsDevPath);
    if (!modelsDevCache) {
      modelsDevCache = await readCache(modelsDevPath);
      cacheDocuments.set(modelsDevPath, modelsDevCache);
    }
    const modelsDev = await loadModelsDevCatalog(
      loaded.root.modelsDev,
      modelsDevCache,
      modelsDevPath,
      controller.signal,
      forceRefresh,
    );
    for (const provider of loaded.providers) {
      const path = cachePath(provider, loaded.root.cache);
      let cache = cacheDocuments.get(path);
      if (!cache) {
        cache = await readCache(path);
        cacheDocuments.set(path, cache);
      }
      const models = await discoverProvider(provider, cache, path, controller.signal, forceRefresh);
      discoveredModels.set(
        provider.name,
        models.map((model) => enrichWithModelsDev(provider, model, modelsDev)),
      );
    }
  };

  await discoverAll(false);
  const registerAll = () => {
    for (const provider of loaded.providers) {
      pi.registerProvider(
        provider.name,
        providerConfig(provider, discoveredModels.get(provider.name) ?? []),
      );
    }
  };
  registerAll();

  pi.registerCommand("refresh-custom-provider-models", {
    description: "Refresh model catalogs for custom providers",
    handler: async (_args, ctx) => {
      await discoverAll(true);
      registerAll();
      ctx.ui.notify("Custom provider models refreshed", "info");
    },
  });

  pi.on("session_shutdown", () => {
    controller.abort();
  });
}
