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
export declare function modelKey(provider: string, model: string): string;
/** Reject a non-object configuration value, tolerating `undefined` for absent sections. */
export declare function object(value: unknown, label: string): Settings;
/**
 * Parse `300k`, `0.3m`, or `300000` into a positive safe integer token count.
 * `k`/`m` are decimal units, matching the reference extension.
 */
export declare function parseLimit(input: string): number;
/**
 * Validate one absolute threshold against the recent-tail budget the compaction
 * backend will keep verbatim and against the real model context window.
 */
export declare function validateLimit(limit: number, contextWindow: number, retainTokens: number): void;
/**
 * Optional global defaults from this plugin's own `config`; the command never
 * writes them and a session command overrides them without persisting anything.
 */
export declare function defaultLimits(config: {
    modelLimits?: unknown;
}): Map<string, number>;
/**
 * Resolve the effective absolute threshold for one route: a session override
 * always wins, including an explicit `null` that suppresses a global default.
 */
export declare function resolveLimit(overrides: ReadonlyMap<string, number | null>, defaults: ReadonlyMap<string, number>, key: string): number | undefined;
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
export declare function nativePolicy(engine: unknown): NativeCompactionPolicy | undefined;
/**
 * Whether the mounted backend still performs automatic compaction. An absent
 * policy counts as enabled, so unknown backends keep working.
 */
export declare function nativeAutoEnabled(engine: unknown): boolean;
/**
 * Whether the mounted backend supports compacting an explicit surface region,
 * which is the capability an earlier threshold is expressed through.
 */
export declare function supportsRegions(engine: unknown): boolean;
/**
 * Resolve the recent-tail budget for one exact route the same way the native
 * backend's `resolveCompactSpec` does: an exact `provider/model` policy wins,
 * then the backend default, and the plugin fallback applies only when the
 * backend publishes no usable retention policy at all.
 */
export declare function nativeRetainTokens(policy: NativeCompactionPolicy | undefined, provider: string, model: string, contextWindow: number, reservedCompletionTokens: number, fallback: number): number;
//# sourceMappingURL=settings.d.ts.map