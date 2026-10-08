import { readFile } from "node:fs/promises";

export type Settings = Record<string, unknown>;

export function object(value: unknown, label: string): Settings {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Settings;
}

export function parseLimit(input: string): number {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(input.trim());
  if (!match) throw new Error("Usage: /autocompact [300k | 1m | 300000 | off | default]");
  const limit = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Threshold must be a positive safe integer number of tokens");
  }
  return limit;
}

function tokenValue(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function effectiveCompaction(global: Settings, project: Settings, modelKey: string) {
  const g = object(global.compaction, "compaction");
  const p = object(project.compaction, "project compaction");
  const gm = object(object(g.modelOverrides, "modelOverrides")[modelKey], "model override");
  const pm = object(object(p.modelOverrides, "modelOverrides")[modelKey], "project model override");
  const resolve = (field: string, fallback: number) => {
    const values = [pm[field], gm[field], p[field], g[field]].map((v) => tokenValue(v, field));
    return values.find((v) => v !== undefined) ?? fallback;
  };
  return {
    enabled: (p.enabled ?? g.enabled ?? true) !== false,
    reserveTokens: resolve("reserveTokens", 16384),
    keepRecentTokens: resolve("keepRecentTokens", 20000),
  };
}

export function validateLimit(
  limit: number,
  contextWindow: number,
  keepRecentTokens: number,
): void {
  if (!Number.isSafeInteger(limit) || limit <= keepRecentTokens) {
    throw new Error(
      `Threshold must be an integer greater than keepRecentTokens (${keepRecentTokens})`,
    );
  }
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 || limit >= contextWindow) {
    throw new Error(`Threshold must be less than the model context window (${contextWindow})`);
  }
}

/** Optional user defaults; the command never writes this configuration. */
export function defaultLimits(settings: Settings): Map<string, number> {
  const config = object(settings.piAutocompact, "piAutocompact");
  const models = object(config.modelLimits, "piAutocompact.modelLimits");
  return new Map(
    Object.entries(models).map(([key, value]) => {
      if (
        !key.includes("/") ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new Error(`Invalid piAutocompact.modelLimits entry: ${key}`);
      }
      return [key, value];
    }),
  );
}

export async function readSettings(path: string): Promise<Settings> {
  try {
    return object(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function supportsBoundaries(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 0 || minor > 87 || (minor === 87 && patch >= 1);
}
