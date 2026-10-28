import { getModelMetadataIds } from "./model-metadata.ts";
import { isGrokMediaModel, pickXaiReasoning, toInputModalities } from "./xai.ts";
import { EXCLUDED, OPENAI, REASONING, THINKING_LEVELS } from "./types.ts";
import type { DiscoveredModel, RelayConfig } from "./types.ts";
import {
  asRecord,
  discardResponse,
  fetchText,
  firstMaxTokensWithinContext,
  firstPositiveInteger,
  isSafeModelId,
  sanitizeDisplayString,
  toPositiveInteger,
} from "./util.ts";

function pickRemoteContextWindow(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return firstPositiveInteger(
    model.context_window,
    model.contextWindow,
    model.context_length,
    model.max_context_tokens,
    model.max_input_tokens,
    limit?.context,
    limits?.context,
  );
}

function remoteMaxTokenAliases(model: Record<string, unknown>) {
  const limit = asRecord(model.limit);
  const limits = asRecord(model.limits);
  return [
    model.max_tokens,
    model.maxTokens,
    model.max_output_tokens,
    model.max_completion_tokens,
    limit?.output,
    limits?.output,
  ];
}

function pickRemoteMaxTokens(model: Record<string, unknown>) {
  return firstPositiveInteger(...remoteMaxTokenAliases(model));
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
    } else if ((THINKING_LEVELS as readonly string[]).includes(normalized)) {
      supported.add(normalized);
      recognized = true;
    }
  }
  return recognized ? THINKING_LEVELS.filter((level) => supported.has(level)) : undefined;
}

function mergeSupportedThinkingLevels(...levels: (string[] | undefined)[]) {
  const supported = new Set(levels.flatMap((values) => values ?? []));
  if (!levels.some((values) => values !== undefined)) return undefined;
  return THINKING_LEVELS.filter((level) => supported.has(level));
}

async function fetchModelInventory(relay: RelayConfig): Promise<DiscoveredModel[]> {
  const result = await fetchText(`${relay.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
  });
  if (!result) throw new Error("request failed");
  if (!result.response.ok) {
    discardResponse(result.response);
    throw new Error(`HTTP ${result.response.status} ${result.response.statusText}`.trim());
  }
  if ("bodyError" in result) throw result.bodyError;
  if (!("text" in result)) throw new Error("model response body is unavailable");

  const payload = asRecord(JSON.parse(result.text) as unknown);
  if (!Array.isArray(payload?.data)) {
    if (relay.xai) throw new Error("model inventory must contain a data array");
    return [];
  }

  const seen = new Set<string>();
  const models = payload.data
    .map(asRecord)
    .filter((model): model is Record<string, unknown> => Boolean(model))
    .filter((model): model is Record<string, unknown> & { id: string } => {
      if (!isSafeModelId(model.id) || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    // Sub2API lists Grok image/video generators beside chat models. Excluding every
    // non-chat ID here lets an inventory without chat models fail visibly.
    .filter((model) => !relay.xai || !(isGrokMediaModel(model.id) || EXCLUDED.test(model.id)))
    .map((model): DiscoveredModel => {
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
        ...(relay.xai
          ? {
              // Every valid alias, so one that does not fit the context falls through.
              remoteMaxTokens: remoteMaxTokenAliases(model)
                .map(toPositiveInteger)
                .filter((value) => value !== undefined),
              input: toInputModalities(model.input_modalities),
              xaiReasoning: pickXaiReasoning(model),
            }
          : { supportedThinkingLevels: pickRemoteThinkingLevels(model) }),
      };
    });
  if (relay.xai && models.length === 0) {
    throw new Error("model inventory contains no valid chat model IDs");
  }
  return models;
}

async function fetchCodexManifest(relay: RelayConfig) {
  const models = new Map<string, DiscoveredModel>();
  const result = await fetchText(`${relay.anthropicBaseUrl}/backend-api/codex/models`, {
    headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
  });
  if (!result) throw new Error("request failed");
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
  return models;
}

export type ModelDiscovery = { ok: true; models: DiscoveredModel[] } | { ok: false; error: Error };

async function discoverModels(relay: RelayConfig): Promise<DiscoveredModel[]> {
  if (relay.api === "openai-codex-responses") {
    return [...(await fetchCodexManifest(relay)).values()];
  }
  // xAI entries use /v1/models as their sole inventory and metadata source.
  if (relay.xai) return fetchModelInventory(relay);
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

  // The manifest only enriches an inventory that already succeeded. A manifest
  // failure keeps that inventory instead of failing discovery.
  let manifest: Awaited<ReturnType<typeof fetchCodexManifest>>;
  try {
    manifest = await fetchCodexManifest(relay);
  } catch {
    return models;
  }
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

export async function fetchModels(relay: RelayConfig): Promise<ModelDiscovery> {
  try {
    return { ok: true, models: await discoverModels(relay) };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const what = relay.api === "openai-codex-responses" ? "Codex model manifest" : "models";
    console.error(`[sub2api:${relay.provider}] failed to fetch ${what}:`, failure);
    return { ok: false, error: failure };
  }
}
