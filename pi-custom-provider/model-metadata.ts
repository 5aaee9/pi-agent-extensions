import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

import {
  extractThinkingValues,
  mapThinkingLevels,
  normalizeThinkingName,
  readExplicitThinkingMap,
} from "./thinking.ts";
import type { DiscoveredModel, JsonRecord, SupportedApi } from "./types.ts";
import {
  asRecord,
  firstNonNegativeNumber,
  firstPositiveInteger,
  isSafeModelId,
  readBoolean,
  sanitizeDisplayString,
} from "./util.ts";

export const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} satisfies ProviderModelConfig["cost"];

export function pickContextWindow(model: JsonRecord) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  const context = asRecord(model.context);
  return firstPositiveInteger(
    model.context_window,
    model.contextWindow,
    model.context_length,
    model.max_input_tokens,
    model.maxInputTokens,
    model.max_context_tokens,
    model.maxContextTokens,
    limit?.context,
    limit?.input,
    limits?.context,
    limits?.input,
    context?.window,
    context?.length,
  );
}

export function pickMaxTokens(model: JsonRecord) {
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

export function pickThinkingValues(model: JsonRecord) {
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

export function hasReasoningMetadata(model: JsonRecord, thinkingValues: string[] | undefined) {
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

export function pickReasoning(model: JsonRecord, thinkingValues: string[] | undefined) {
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

export function hasInputMetadata(model: JsonRecord) {
  const architecture = asRecord(model.architecture);
  const capabilities = asRecord(model.capabilities);
  return [
    model.input_modalities,
    model.inputModalities,
    model.modalities,
    model.input,
    asRecord(model.modalities)?.input,
    architecture?.input_modalities,
    architecture?.inputModalities,
    capabilities?.input_modalities,
    capabilities?.inputModalities,
  ].some((value) => Array.isArray(value));
}

export function pickInputTypes(model: JsonRecord) {
  const architecture = asRecord(model.architecture);
  const capabilities = asRecord(model.capabilities);
  const raw = [
    model.input_modalities,
    model.inputModalities,
    model.modalities,
    model.input,
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

export function pickCost(model: JsonRecord): {
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

export function pickCompat(model: JsonRecord, api: SupportedApi): JsonRecord | undefined {
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

export function parseDiscoveredModel(
  model: JsonRecord,
  api: SupportedApi,
): DiscoveredModel | undefined {
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
