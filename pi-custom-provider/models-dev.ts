import { trimModelsDevCatalog } from "./cache.ts";
import { pickCost } from "./model-metadata.ts";
import {
  extractThinkingValues,
  mapThinkingLevels,
  thinkingFromSuffix,
  variantKey,
} from "./thinking.ts";
import { MAX_MODELS_DEV_RESPONSE_BYTES } from "./types.ts";
import type {
  CacheDocument,
  DiscoveredModel,
  JsonRecord,
  ModelsDevCatalog,
  ModelsDevOptions,
  ProviderDefinition,
  SupportedApi,
} from "./types.ts";
import { asRecord, fetchJson, firstPositiveInteger, sanitizeDisplayString } from "./util.ts";

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

/** Lowercased key -> value of the first key with that spelling, built once per record. */
const lowercaseIndexes = new WeakMap<JsonRecord, Map<string, unknown>>();

function lookupRecord(record: JsonRecord | undefined, id: string) {
  if (!record) return undefined;
  const exact = asRecord(record[id]);
  if (exact) return exact;
  let index = lowercaseIndexes.get(record);
  if (!index) {
    index = new Map();
    for (const [key, value] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (!index.has(lower)) index.set(lower, value);
    }
    lowercaseIndexes.set(record, index);
  }
  return asRecord(index.get(id.toLowerCase()));
}

const providerModelRecords = new WeakMap<JsonRecord, JsonRecord[]>();

/** Every provider's `models` record in catalog order, computed once per catalog. */
function allProviderModelRecords(providers: JsonRecord): JsonRecord[] {
  let records = providerModelRecords.get(providers);
  if (!records) {
    records = Object.values(providers).flatMap((value) => {
      const models = asRecord(asRecord(value)?.models);
      return models ? [models] : [];
    });
    providerModelRecords.set(providers, records);
  }
  return records;
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
    const models = asRecord(lookupRecord(catalog.providers, providerId)?.models);
    return models ? [models] : [];
  });
  const searchOrder = [...providerRecords, ...allProviderModelRecords(catalog.providers)];
  for (const candidate of candidates) {
    for (const models of searchOrder) {
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

export function enrichWithModelsDev(
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

export function emptyModelsDevCatalog(): ModelsDevCatalog {
  return { providers: {}, models: {} };
}

function modelsDevCacheKey(options: ModelsDevOptions) {
  return JSON.stringify({ apiURL: options.apiURL, modelsURL: options.modelsURL });
}

/**
 * The cached catalog, if it is usable for these options, and whether it is past
 * its TTL. Disabled models.dev yields an empty catalog that never expires.
 */
export function cachedModelsDevCatalog(
  options: ModelsDevOptions,
  cache: CacheDocument,
): { catalog: ModelsDevCatalog; expired: boolean } | undefined {
  if (!options.enabled) return { catalog: emptyModelsDevCatalog(), expired: false };
  const cached = cache.modelsDev;
  if (
    cached === undefined ||
    (cached.cacheKey !== undefined && cached.cacheKey !== modelsDevCacheKey(options)) ||
    !Number.isFinite(cached.fetchedAt) ||
    (Object.keys(cached.providers).length === 0 && Object.keys(cached.models).length === 0)
  ) {
    return undefined;
  }
  return {
    catalog: { providers: cached.providers, models: cached.models },
    expired: Date.now() - cached.fetchedAt > options.ttlSeconds * 1000,
  };
}

export async function loadModelsDevCatalog(
  options: ModelsDevOptions,
  cache: CacheDocument,
  persist: () => Promise<void>,
  signal: AbortSignal,
  forceRefresh: boolean,
): Promise<ModelsDevCatalog> {
  if (!options.enabled) return emptyModelsDevCatalog();
  const usableCached = cachedModelsDevCatalog(options, cache);
  if (!forceRefresh && usableCached && !usableCached.expired) return usableCached.catalog;
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
  const providers =
    apiResult.status === "fulfilled" ? asRecord(apiResult.value) : usableCached?.catalog.providers;
  const models =
    modelsResult.status === "fulfilled"
      ? asRecord(modelsResult.value)
      : usableCached?.catalog.models;
  if (!providers && !models) {
    if (usableCached) {
      console.warn("[custom-provider] models.dev refresh failed; using cached metadata");
      return usableCached.catalog;
    }
    console.warn("[custom-provider] failed to fetch models.dev metadata");
    return emptyModelsDevCatalog();
  }

  const catalog = trimModelsDevCatalog({ providers: providers ?? {}, models: models ?? {} });
  cache.modelsDev = {
    ...catalog,
    fetchedAt: Date.now(),
    cacheKey: modelsDevCacheKey(options),
    trimmed: true,
  };
  try {
    await persist();
  } catch (error) {
    console.warn("[custom-provider] failed to write models.dev cache:", error);
  }
  if (apiResult.status === "rejected" || modelsResult.status === "rejected") {
    console.warn("[custom-provider] models.dev refresh partially failed; using available metadata");
  }
  return catalog;
}
