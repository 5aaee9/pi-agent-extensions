import { getModelMetadataIds } from "./model-metadata.ts";
import { EXCLUDED, OPENAI, REASONING } from "./types.ts";
import type { DiscoveredModel, RelayConfig } from "./types.ts";
import {
  asRecord,
  discardResponse,
  fetchText,
  firstMaxTokensWithinContext,
  firstPositiveInteger,
  isSafeModelId,
  sanitizeDisplayString,
} from "./util.ts";

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
  } catch (error) {
    // Explicit Codex relays require the manifest; auto/other API relays only
    // use it as optional metadata enrichment and retain their inventory.
    if (relay.api === "openai-codex-responses") {
      console.error(`[sub2api:${relay.provider}] failed to fetch Codex model manifest:`, error);
    }
  }
  return models;
}

export async function fetchModels(relay: RelayConfig): Promise<DiscoveredModel[]> {
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
