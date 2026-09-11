import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

import { cacheKey, writeCache } from "./cache.ts";
import { resolveConfigValue, toProviderValue } from "./config.ts";
import { parseDiscoveredModel, pickCost, pickInputTypes } from "./model-metadata.ts";
import {
  OLLAMA_SHOW_CONCURRENCY,
  OLLAMA_THINKING_LEVELS,
  streamOllamaChatSimple,
} from "./ollama.ts";
import { readExplicitThinkingMap } from "./thinking.ts";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, MAX_RESPONSE_BYTES } from "./types.ts";
import type { CacheDocument, DiscoveredModel, JsonRecord, ProviderDefinition } from "./types.ts";
import { asRecord, fetchJson, mergeCompat, toPositiveInteger } from "./util.ts";

export function discoveryHeaders(provider: ProviderDefinition) {
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

export async function fetchModels(provider: ProviderDefinition, signal: AbortSignal) {
  const payload = await fetchJson(
    provider.modelsURL,
    signal,
    discoveryHeaders(provider),
    MAX_RESPONSE_BYTES,
  );
  const root = asRecord(payload);
  const values = Array.isArray(payload) ? payload : (root?.data ?? root?.models);
  if (!Array.isArray(values)) throw new Error("model response must contain a data or models array");
  const records = values.map((value) => asRecord(value) ?? {});
  const enriched =
    provider.api === "ollama-chat" ? await enrichOllamaModels(provider, records, signal) : records;
  const seen = new Set<string>();
  return enriched.flatMap((value) => {
    const model = parseDiscoveredModel(value, provider.api);
    if (!model || seen.has(model.id)) return [];
    seen.add(model.id);
    return [model];
  });
}

/**
 * Ollama `/api/tags` only lists model names. `POST /api/show` per model reveals
 * `capabilities` (e.g. "thinking", "vision", "tools") and `model_info`, whose
 * `*.context_length` key carries the trained context window. The results are
 * folded back into the generic metadata record so `parseDiscoveredModel` sees
 * the usual `reasoning`/`input_modalities`/`context_window` fields.
 */
async function enrichOllamaModels(
  provider: ProviderDefinition,
  records: JsonRecord[],
  signal: AbortSignal,
): Promise<JsonRecord[]> {
  const showURL = `${provider.ollamaBaseURL}/api/show`;
  const headers = discoveryHeaders(provider);
  const result = Array.from<JsonRecord>({ length: records.length });
  let cursor = 0;
  const worker = async () => {
    while (cursor < records.length) {
      const index = cursor++;
      const record = records[index]!;
      result[index] = record;
      const name = record.model ?? record.name ?? record.id;
      if (typeof name !== "string" || !name.trim()) continue;
      try {
        const shown = asRecord(
          await fetchJson(
            showURL,
            signal,
            headers,
            MAX_RESPONSE_BYTES,
            JSON.stringify({ model: name }),
          ),
        );
        if (shown) result[index] = mergeOllamaShowRecord(record, shown);
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn(`[custom-provider:${provider.name}] /api/show failed for ${name}:`, error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(OLLAMA_SHOW_CONCURRENCY, records.length) }, worker),
  );
  return result;
}

function mergeOllamaShowRecord(tag: JsonRecord, shown: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...tag };
  const capabilities = Array.isArray(shown.capabilities)
    ? shown.capabilities.filter((value): value is string => typeof value === "string")
    : undefined;
  if (capabilities && capabilities.length > 0) {
    merged.reasoning = capabilities.some((capability) => capability.toLowerCase() === "thinking");
    if (capabilities.some((capability) => capability.toLowerCase() === "vision")) {
      merged.input_modalities = ["text", "image"];
    }
    // Ollama thinking-capable models accept effort strings low/medium/high/max.
    if (merged.reasoning) merged.supported_reasoning_levels = [...OLLAMA_THINKING_LEVELS];
  }
  const modelInfo = asRecord(shown.model_info);
  if (modelInfo) {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.toLowerCase().endsWith(".context_length")) {
        const context = toPositiveInteger(value);
        if (context !== undefined) {
          merged.context_window ??= context;
          break;
        }
      }
    }
  }
  return merged;
}

/**
 * Apply provider-level heuristics after upstream parsing and models.dev
 * enrichment. These fill fields the upstream/catalog did not provide:
 * `reasoningPattern` marks models reasoning-capable by id, and `modelDefaults`
 * fills any field that is still unprovided. `thinkingLevelMap` defaults apply
 * only to reasoning models.
 */
export function applyProviderHeuristics(
  provider: ProviderDefinition,
  model: DiscoveredModel,
): DiscoveredModel {
  let result = model;
  if (!result.reasoningProvided && provider.reasoningPattern?.test(result.id)) {
    result = { ...result, reasoning: true, reasoningProvided: true };
  }
  const defaults = provider.modelDefaults;
  if (!defaults) return result;

  const next = { ...result };
  if (!next.reasoningProvided && typeof defaults.reasoning === "boolean") {
    next.reasoning = defaults.reasoning;
    next.reasoningProvided = true;
  }
  if (!next.inputProvided && Array.isArray(defaults.input)) {
    next.input = pickInputTypes({ input: defaults.input });
    next.inputProvided = true;
  }
  if (next.contextWindow === undefined) {
    next.contextWindow = toPositiveInteger(defaults.contextWindow ?? defaults.context_window);
  }
  if (next.maxTokens === undefined) {
    next.maxTokens = toPositiveInteger(defaults.maxTokens ?? defaults.max_tokens);
  }
  if (!next.costProvided) {
    const picked = pickCost({ cost: defaults.cost });
    if (picked.provided) {
      next.cost = picked.cost;
      next.costProvided = true;
      next.costFields = picked.fields;
    }
  }
  if (next.reasoning && !next.thinkingLevelMapProvided) {
    const map = readExplicitThinkingMap({ thinkingLevelMap: defaults.thinkingLevelMap });
    if (map) {
      next.thinkingLevelMap = map;
      next.thinkingLevelMapProvided = true;
    }
  }
  next.compat = mergeCompat(asRecord(defaults.compat), next.compat);
  return next;
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

export function modelConfigForProvider(
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
    baseUrl:
      api === "anthropic-messages"
        ? provider.anthropicBaseURL
        : api === "ollama-chat"
          ? provider.ollamaBaseURL
          : provider.openaiBaseURL,
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

export function credentialApiKey(credential: unknown): string | undefined {
  const record = asRecord(credential);
  if (!record) return undefined;
  if (record.type === "api_key" && typeof record.key === "string" && record.key.trim()) {
    return record.key;
  }
  if (record.type === "oauth" && typeof record.access === "string" && record.access.trim()) {
    return record.access;
  }
  return undefined;
}

export function providerConfig(
  provider: ProviderDefinition,
  models: DiscoveredModel[],
  refreshModels?: ProviderConfig["refreshModels"],
): ProviderConfig {
  const configs = models.map((model) => modelConfigForProvider(provider, model));
  const headers = registeredHeaders(provider.headers);
  const usesAuthorizationHeader = provider.useAuthorizationHeader;
  const hasAuthorizationHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization",
  );
  // A `!command` apiKey needs the Bearer prefix inside the executed command so
  // pi interpolates the command stdout. pi's authHeader would wrap the literal
  // command instead, so keep the header form for that case only.
  const needsCommandWrapper =
    usesAuthorizationHeader && provider.apiKey?.startsWith("!") === true && !hasAuthorizationHeader;
  if (needsCommandWrapper && provider.apiKey) {
    headers.Authorization = `!printf 'Bearer %s' "$(${provider.apiKey.slice(1)})"`;
  }
  return {
    name: provider.name,
    baseUrl:
      provider.api === "anthropic-messages"
        ? provider.anthropicBaseURL
        : provider.api === "ollama-chat"
          ? provider.ollamaBaseURL
          : provider.openaiBaseURL,
    // Always register the key: pi's availability check only counts apiKey/oauth,
    // so a key hidden inside headers leaves the provider "unconfigured" and its
    // models are filtered out of the model list entirely. authHeader tells pi
    // to also send Authorization: Bearer <apiKey> at request time (it would
    // clobber a user-configured Authorization header, so skip it there).
    apiKey: registeredApiKey(provider.apiKey),
    api: provider.api,
    ...(usesAuthorizationHeader && !needsCommandWrapper && !hasAuthorizationHeader
      ? { authHeader: true }
      : {}),
    headers,
    models: configs,
    ...(provider.api === "ollama-chat" ? { streamSimple: streamOllamaChatSimple } : {}),
    ...(refreshModels ? { refreshModels } : {}),
  };
}

export async function discoverProvider(
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
    if (models.length === 0 && provider.fallbackModels.length > 0) {
      console.warn(
        `[custom-provider:${provider.name}] upstream returned no usable models; using fallbackModels`,
      );
      return provider.fallbackModels;
    }
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
    if (provider.fallbackModels.length > 0) {
      console.warn(
        `[custom-provider:${provider.name}] model discovery failed; using fallbackModels`,
      );
      return provider.fallbackModels;
    }
    console.error(`[custom-provider:${provider.name}] failed to fetch models:`, error);
    return [];
  }
}
