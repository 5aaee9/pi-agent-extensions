import type { Api, Model, ModelCost } from "@earendil-works/pi-ai";

import { XAI_EFFORTS } from "./types.ts";
import type {
  BuiltinModelMetadata,
  DiscoveredModel,
  XaiEffort,
  XaiRemoteReasoning,
} from "./types.ts";
import { asRecord, firstMaxTokensWithinContext, firstPositiveInteger } from "./util.ts";

type ThinkingLevelMap = NonNullable<Model<Api>["thinkingLevelMap"]>;
type InputModality = "text" | "image";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 16_384;
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const GROK_PREFIXES = ["xai/", "x-ai/", "grok/"];
const GROK_MEDIA_IDS = new Set([
  "grok-imagine",
  "grok-imagine-1",
  "grok-imagine-edit",
  "grok-video-1.5",
]);
const GROK_MEDIA_PREFIXES = ["imagine", "grok-imagine-image", "grok-imagine-video"];

// Mirrors Sub2API's IsGrokImagineModel. Normalization is for classification only;
// registered IDs keep their original spelling.
export function isGrokMediaModel(modelId: string) {
  let normalized = modelId.trim().toLowerCase();
  const prefix = GROK_PREFIXES.find((candidate) => normalized.startsWith(candidate));
  if (prefix) normalized = normalized.slice(prefix.length).trim();
  return (
    GROK_MEDIA_IDS.has(normalized) ||
    GROK_MEDIA_PREFIXES.some((mediaPrefix) => normalized.startsWith(mediaPrefix))
  );
}

function toXaiEffort(value: unknown): XaiEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return XAI_EFFORTS.find((effort) => effort === normalized);
}

function toEffortList(entries: unknown[], read: (entry: unknown) => unknown): XaiEffort[] {
  const efforts = new Set(entries.map((entry) => toXaiEffort(read(entry))));
  return XAI_EFFORTS.filter((effort) => efforts.has(effort));
}

export function pickXaiReasoning(model: Record<string, unknown>): XaiRemoteReasoning {
  const flag = model.supportsReasoningEffort;
  let efforts: XaiEffort[] | undefined;
  if (Array.isArray(model.reasoningEfforts)) {
    efforts = toEffortList(model.reasoningEfforts, (entry) => asRecord(entry)?.value);
  } else {
    const levels = [model.supported_reasoning_levels, model.supportedReasoningLevels].find(
      (value): value is unknown[] => Array.isArray(value),
    );
    if (levels) {
      efforts = toEffortList(levels, (entry) =>
        typeof entry === "string" ? entry : asRecord(entry)?.effort,
      );
    }
  }
  return {
    ...(typeof flag === "boolean" ? { supportsReasoningEffort: flag } : {}),
    ...(efforts ? { efforts } : {}),
  };
}

export function toInputModalities(value: unknown): InputModality[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const input = [
    ...new Set(
      value.filter((entry): entry is InputModality => entry === "text" || entry === "image"),
    ),
  ];
  return input.length ? input : undefined;
}

// Reads a catalog thinking map with Pi's level semantics: null disables a level,
// xhigh/max need an explicit value, and an unset `off` sends "none". A present map
// is an authoritative bound, even when it enables no recognized effort.
function catalogEfforts(metadata: BuiltinModelMetadata | undefined): XaiEffort[] | undefined {
  const map = asRecord(metadata?.thinkingLevelMap);
  if (!map) return undefined;
  const efforts = new Set<XaiEffort | undefined>();
  for (const level of PI_THINKING_LEVELS) {
    const mapped = map[level];
    if (mapped === null || ((level === "xhigh" || level === "max") && mapped === undefined)) {
      continue;
    }
    efforts.add(toXaiEffort(mapped ?? (level === "off" ? "none" : level)));
  }
  return XAI_EFFORTS.filter((effort) => efforts.has(effort));
}

// Without configurable efforts only `off` remains selectable; its mapping stays
// unset so the request wrapper can omit the reasoning control entirely.
export function getXaiThinkingLevelMap(efforts: readonly XaiEffort[]): ThinkingLevelMap {
  const supported = new Set(efforts);
  const level = (effort: XaiEffort) => (supported.has(effort) ? effort : null);
  return {
    ...(efforts.length ? { off: level("none") } : {}),
    minimal: null,
    low: level("low"),
    medium: level("medium"),
    high: level("high"),
    xhigh: level("xhigh"),
    max: null,
  };
}

export interface ResolvedXaiMetadata {
  contextWindow: number;
  maxTokens: number;
  input: InputModality[];
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  cost?: ModelCost;
}

// Resolves each field independently: remote inventory, cached xAI catalog, bundled
// xAI catalog, then defaults. Catalog entries are exact-ID matches.
export function resolveXaiMetadata(
  model: DiscoveredModel,
  cached: BuiltinModelMetadata | undefined,
  bundled: BuiltinModelMetadata | undefined,
): ResolvedXaiMetadata {
  const contextWindow =
    firstPositiveInteger(model.contextWindow, cached?.contextWindow, bundled?.contextWindow) ??
    DEFAULT_CONTEXT_WINDOW;
  const maxTokens =
    firstMaxTokensWithinContext(
      contextWindow,
      ...(model.remoteMaxTokens ?? [model.maxTokens]),
      ...[cached?.maxTokens, bundled?.maxTokens].map((value) => firstPositiveInteger(value)),
    ) ?? Math.min(DEFAULT_MAX_TOKENS, contextWindow);
  const input = model.input ??
    toInputModalities(cached?.input) ??
    toInputModalities(bundled?.input) ?? ["text"];

  const remote = model.xaiReasoning ?? {};
  const remoteReasoning =
    remote.supportsReasoningEffort === true ||
    remote.efforts?.some((effort) => effort !== "none") === true;
  const reasoning =
    remoteReasoning ||
    (typeof cached?.reasoning === "boolean" ? cached.reasoning : bundled?.reasoning === true);
  const efforts =
    remote.supportsReasoningEffort === false
      ? []
      : (remote.efforts ?? catalogEfforts(cached) ?? catalogEfforts(bundled) ?? []);

  return {
    contextWindow,
    maxTokens,
    input,
    reasoning,
    ...(reasoning ? { thinkingLevelMap: getXaiThinkingLevelMap(efforts) } : {}),
    cost: cached?.cost ?? bundled?.cost,
  };
}
