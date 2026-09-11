import type { SupportedApi, ThinkingLevel, ThinkingLevelMap } from "./types.ts";
import { asRecord } from "./util.ts";

export const THINKING_LEVELS: ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const THINKING_ALIASES: Record<string, ThinkingLevel> = {
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

export const MODEL_VARIANT_SUFFIXES = [
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

export function variantKey(uid: string): string | null {
  for (const suffix of MODEL_VARIANT_SUFFIXES) {
    if (uid === suffix || uid.endsWith(`-${suffix}`)) return suffix;
  }
  return null;
}

export function thinkingFromSuffix(suffix: string | null): ThinkingLevel | null {
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

export function normalizeThinkingName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function extractThinkingValues(value: unknown): string[] {
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

export function readExplicitThinkingMap(
  model: Record<string, unknown>,
): ThinkingLevelMap | undefined {
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

export function mapThinkingLevels(
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
