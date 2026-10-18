/**
 * Threshold parsing, global defaults, validation, and read-only introspection
 * of the mounted compaction backend's native retention policy.
 *
 * Nothing in this module writes configuration: the command only keeps an
 * in-memory session map, exactly like `pi-autocompact` never writes settings.
 *
 * @module @indexyz/dsh-autocompact/settings
 */

/** Untrusted JSON-shaped configuration object. */
export type Settings = Record<string, unknown>;

/** One exact `provider/model` route key, the unit every threshold is keyed by. */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/** Reject a non-object configuration value, tolerating `undefined` for absent sections. */
export function object(value: unknown, label: string): Settings {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Settings;
}

/**
 * Parse `300k`, `0.3m`, or `300000` into a positive safe integer token count.
 * `k`/`m` are decimal units, matching the reference extension.
 */
export function parseLimit(input: string): number {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(input.trim());
  if (!match) throw new Error("Usage: /autocompact [300k | 1m | 300000 | off | default]");
  const limit = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Threshold must be a positive safe integer number of tokens");
  }
  return limit;
}

/**
 * Validate one absolute threshold against the recent-tail budget the compaction
 * backend will keep verbatim and against the real model context window.
 */
export function validateLimit(limit: number, contextWindow: number, retainTokens: number): void {
  if (!Number.isSafeInteger(limit) || limit <= retainTokens) {
    throw new Error(
      `Threshold must be an integer greater than the retained token budget (${retainTokens})`,
    );
  }
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 || limit >= contextWindow) {
    throw new Error(`Threshold must be less than the model context window (${contextWindow})`);
  }
}

/**
 * Validate the optional deployment-wide threshold.
 *
 * `undefined` means "no default": a model without its own threshold keeps the
 * backend's automatic compaction. A configured value must be a positive safe
 * integer, the same rule every `modelLimits` entry follows.
 */
export function validateDefaultLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("autocompact.defaultLimit must be a positive safe integer number of tokens");
  }
  return value;
}

/**
 * Optional global defaults from this plugin's own `config`; the command never
 * writes them and a session command overrides them without persisting anything.
 */
export function defaultLimits(config: { modelLimits?: unknown }): Map<string, number> {
  const models = object(config.modelLimits, "autocompact.modelLimits");
  return new Map(
    Object.entries(models).map(([key, value]) => {
      if (
        !key.includes("/") ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new Error(`Invalid autocompact.modelLimits entry: ${key}`);
      }
      return [key, value];
    }),
  );
}

/**
 * Resolve the effective absolute threshold for one route.
 *
 * A session override always wins, including an explicit `null` that suppresses
 * every persisted layer. Below it an exact `provider/model` entry wins over the
 * deployment-wide default; with neither configured the route has no threshold
 * and autocompact stays off for it.
 */
export function resolveLimit(
  overrides: ReadonlyMap<string, number | null>,
  defaults: ReadonlyMap<string, number>,
  key: string,
  defaultLimit?: number,
): number | undefined {
  if (overrides.has(key)) return overrides.get(key) ?? undefined;
  return defaults.get(key) ?? defaultLimit;
}

/** Native compaction policy a backend happens to expose for read-only introspection. */
export interface NativeCompactionPolicy {
  readonly auto?: boolean;
  readonly retainRatio?: number;
  readonly retainTokens?: number;
  readonly modelPolicies?: readonly {
    readonly provider?: string;
    readonly model?: string;
    readonly retainRatio?: number;
    readonly retainTokens?: number;
  }[];
}

/**
 * Read the mounted backend's native policy without depending on a concrete
 * backend package. Any engine that does not publish a `config` object simply
 * yields `undefined`, and the plugin then uses its own fallback budget.
 */
export function nativePolicy(engine: unknown): NativeCompactionPolicy | undefined {
  if (!engine || typeof engine !== "object") return undefined;
  const config = (engine as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  return config as NativeCompactionPolicy;
}

/**
 * Whether the mounted backend still performs automatic compaction. An absent
 * policy counts as enabled, so unknown backends keep working.
 */
export function nativeAutoEnabled(engine: unknown): boolean {
  return nativePolicy(engine)?.auto !== false;
}

/**
 * Whether the mounted backend supports compacting an explicit surface region,
 * which is the capability an earlier threshold is expressed through.
 */
export function supportsRegions(engine: unknown): boolean {
  return typeof (engine as { compactRegion?: unknown } | undefined)?.compactRegion === "function";
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Resolve the recent-tail budget for one exact route the same way the native
 * backend's `resolveCompactSpec` does: an exact `provider/model` policy wins,
 * then the backend default, and the plugin fallback applies only when the
 * backend publishes no usable retention policy at all.
 */
export function nativeRetainTokens(
  policy: NativeCompactionPolicy | undefined,
  provider: string,
  model: string,
  contextWindow: number,
  reservedCompletionTokens: number,
  fallback: number,
): number {
  const override = policy?.modelPolicies?.find(
    (entry) => entry.provider === provider && entry.model === model,
  );
  const absolute = tokenCount(override?.retainTokens) ?? tokenCount(policy?.retainTokens);
  if (absolute !== undefined) return absolute;
  const ratio = override?.retainRatio ?? policy?.retainRatio;
  const messageBudget = contextWindow - reservedCompletionTokens;
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && messageBudget > 0) {
    return Math.floor(messageBudget * ratio);
  }
  return fallback;
}
