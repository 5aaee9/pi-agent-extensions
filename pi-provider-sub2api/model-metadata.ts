import { access } from "node:fs/promises";
import { join } from "node:path";

import type { ModelCost } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import { getAgentDir } from "./config.ts";
import { CODEX_API } from "./codex-api.ts";
import { ADAPTIVE_CLAUDE, CLAUDE, OPENAI, REQUEST_TIMEOUT_MS } from "./types.ts";
import type {
  BuiltinModelMetadata,
  ModelMetadataCatalogs,
  RelayConfig,
  SupportedApi,
} from "./types.ts";

export const METADATA_PROVIDERS = ["anthropic", "openai", "openai-codex", "xai"] as const;
export const BUILTIN_MODEL_METADATA: ModelMetadataCatalogs = new Map(
  METADATA_PROVIDERS.map((provider) => [
    provider,
    new Map<string, BuiltinModelMetadata>(
      getBuiltinModels(provider).map((model) => [model.id, model]),
    ),
  ]),
);
const METADATA_PROVIDERS_BY_API: Record<SupportedApi, (typeof METADATA_PROVIDERS)[number][]> = {
  "anthropic-messages": ["anthropic"],
  "openai-codex-responses": ["openai-codex", "openai"],
  "openai-responses": ["openai", "xai"],
  "openai-completions": ["openai", "xai"],
};

export function getModelApi(modelId: string, configuredApi?: SupportedApi): SupportedApi {
  if (!CODEX_API && configuredApi === "openai-codex-responses") return "openai-responses";
  if (configuredApi) return configuredApi;
  if (CLAUDE.test(modelId)) return "anthropic-messages";
  // OpenAI models use pi's Codex adapter for its Codex-shaped requests; the
  // relay fetch rewrites them to the standard /v1/responses endpoint.
  // Hosts without pi's adapter (OMP) take the plain Responses API instead.
  if (OPENAI.test(modelId)) return CODEX_API ? "openai-codex-responses" : "openai-responses";
  return "openai-responses";
}

export function getApiBaseUrl(relay: RelayConfig, api: SupportedApi) {
  return api === "anthropic-messages" ? relay.anthropicBaseUrl : relay.baseUrl;
}

export function getThinkingLevelMap(
  reasoning: boolean,
  api: SupportedApi,
  supportedThinkingLevels?: string[],
  ultraEnabled = false,
) {
  if (!reasoning) return undefined;
  if (api === "anthropic-messages") return { xhigh: "max" };
  // Relayed Codex backends reject the "none" and "minimal" efforts with
  // upstream 5xx errors, so clamp minimal to low. The Codex adapter omits the
  // reasoning field entirely when thinking is off, while the plain Responses
  // adapter requires off to be unselectable (null) to do the same.
  const map =
    api === "openai-codex-responses"
      ? { off: "none", minimal: "low", xhigh: "xhigh" }
      : { off: null, minimal: "low", xhigh: "xhigh" };
  if (!supportedThinkingLevels) return map;

  const supported = new Set(supportedThinkingLevels);
  return {
    ...map,
    minimal: supported.has("low") ? "low" : null,
    low: supported.has("low") ? "low" : null,
    medium: supported.has("medium") ? "medium" : null,
    high: supported.has("high") ? "high" : null,
    xhigh: supported.has("xhigh") ? "xhigh" : null,
    max:
      ultraEnabled && supported.has("ultra")
        ? "ultra"
        : supported.has("max")
          ? "max"
          : supported.has("ultra")
            ? "ultra"
            : null,
  };
}

export function getModelCompat(modelId: string, api: SupportedApi) {
  return api === "anthropic-messages" && ADAPTIVE_CLAUDE.test(modelId)
    ? { forceAdaptiveThinking: true }
    : undefined;
}

export function getDefaultMaxTokens(modelId: string) {
  return /^claude-haiku-4-5(?:-|$)/i.test(modelId) ? 8192 : 16384;
}

export function getModelMetadataIds(modelId: string) {
  return modelId.toLowerCase() === "gpt-5.6" ? [modelId, "gpt-5.6-sol"] : [modelId];
}

export async function loadCachedModelMetadata(): Promise<ModelMetadataCatalogs | undefined> {
  try {
    const agentDir = getAgentDir();
    const modelsStorePath = join(agentDir, "models-store.json");
    await access(modelsStorePath);
    const [{ ModelRuntime }, { InMemoryCredentialStore }] = await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("@earendil-works/pi-ai"),
    ]);
    if (
      typeof ModelRuntime?.create !== "function" ||
      typeof InMemoryCredentialStore !== "function"
    ) {
      return undefined;
    }
    // Use the host SDK to restore its cached catalog, rather than parsing a
    // private store format or resolving the user's provider credentials.
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath,
      allowModelNetwork: false,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return new Map(
      METADATA_PROVIDERS.map((provider) => [
        provider,
        new Map(
          runtime
            .getModels(provider)
            .map((model) => [
              model.id,
              { contextWindow: model.contextWindow, maxTokens: model.maxTokens, cost: model.cost },
            ]),
        ),
      ]),
    );
  } catch {
    // Missing/unreadable caches and hosts without ModelRuntime keep the static
    // catalog fallback. Metadata restoration failures must not prevent discovery.
    return undefined;
  }
}

export function getBuiltinModelMetadata(
  modelId: string,
  api: SupportedApi,
  cachedMetadata?: ModelMetadataCatalogs,
) {
  for (const candidate of getModelMetadataIds(modelId)) {
    for (const provider of METADATA_PROVIDERS_BY_API[api]) {
      const metadata =
        cachedMetadata?.get(provider)?.get(candidate) ??
        BUILTIN_MODEL_METADATA.get(provider)?.get(candidate);
      if (metadata) return metadata;
    }
  }
  return undefined;
}

export function scaleModelCost(cost: ModelCost | undefined, multiplier: number): ModelCost {
  if (!cost) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const scaleRates = <T extends ModelCost>(rates: T): T => ({
    ...rates,
    input: rates.input * multiplier,
    output: rates.output * multiplier,
    cacheRead: rates.cacheRead * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
  });
  return {
    ...scaleRates(cost),
    tiers: cost.tiers?.map((tier) => scaleRates(tier)),
  };
}
