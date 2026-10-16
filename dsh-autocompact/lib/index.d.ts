/**
 * Session-only per-model automatic compaction thresholds for dsh.
 *
 * The dsh port of `@indexyz/pi-autocompact`. A `/autocompact 300k` threshold is
 * kept in memory for the current session and model only; when the measured
 * request pressure crosses it, the plugin compacts an explicit balanced surface
 * range through the session's mounted compaction backend before the next
 * request. Nothing is written to configuration, the session log carries only
 * the backend's ordinary compaction records, and the model's real context-window
 * metadata is never modified.
 *
 * `compaction` is not a Host-plane service: the shipped Web bundle disables the
 * root row and lets each Agent preset mount its own isolated instance. This
 * plugin therefore mounts on the Host plane (so one row serves every preset) and
 * addresses the backend of the exact Agent at event time through
 * {@link serviceForAgent}, falling back to the Host plane for compositions (the
 * headless, ACP, and SDK bundles) that do mount it there.
 *
 * @module @indexyz/dsh-autocompact
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CompactionEngine } from "@deepseek-ai/dsh-compaction";
/** Plugin identity used by the Loader and by diagnostics. */
export declare const name = "autocompact";
/** Host-plane services this plugin needs before it can register its command and hook. */
export declare const inject: string[];
/** A `.volatile()` Config field: the Loader parses it into a stable reference read with `get()`. */
export interface VolatileField<T> {
    get(): T | undefined;
}
/**
 * Row configuration as `apply` receives it.
 *
 * The two fields the Settings page writes are declared `.volatile()`, so the
 * Loader hands `apply` live references rather than plain values; a direct call
 * (tests, embedding) may still pass plain values.
 */
export interface AutocompactConfig {
    /** Optional global default thresholds keyed by exact `provider/model`. Never written by the command. */
    modelLimits?: Record<string, number> | VolatileField<Record<string, number>>;
    /** Recent-tail fallback budget used only when the backend publishes no retention policy. */
    retainTokens?: number;
    /** Master switch for the automatic pressure check. */
    enabled?: boolean | VolatileField<boolean>;
}
/**
 * Validated row configuration; misconfiguration fails plugin load.
 *
 * `modelLimits` and `enabled` are volatile because the Settings page edits them
 * through the Host settings service: that service only exposes an entry whose
 * schema declares a volatile field (`volatileForm`), and only accepts writes to
 * volatile paths. A volatile field is also what makes an edit visible to the
 * running plugin without a restart. `retainTokens` stays ordinary configuration,
 * editable from `cordis.patch.yml` only.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    modelLimits: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<number, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<number, string>>, "volatile-defined">;
    retainTokens: z<number, number, "defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    modelLimits: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<number, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<number, string>>, "volatile-defined">;
    retainTokens: z<number, number, "defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
interface Target {
    readonly provider: string;
    readonly model: string;
}
/** Resolve the exact routed route for one agent, mirroring the backend's own lookup. */
export declare function targetOf(agent: Agent): Target | undefined;
/**
 * Resolve the compaction backend serving one Agent.
 *
 * A preset-mounted backend is isolated to that Agent's preset realm, so the
 * Agent's own identity is the only key that reaches it; compositions that mount
 * a backend on the Host plane are served by the direct lookup instead.
 *
 * @param ctx - this plugin's Host-plane context.
 * @param agent - the Agent whose backend is requested.
 * @returns the backend, or `undefined` when this composition mounts none.
 */
export declare function backendFor(ctx: Context, agent: Agent): CompactionEngine | undefined;
/**
 * Register the session-only `/autocompact` command and the automatic pressure
 * check for every Agent.
 *
 * @param ctx - Host-plane context carrying the command registry, the token meter, and the LLM registry.
 * @param config - validated row configuration; the Settings-editable fields arrive as live references.
 */
export declare function apply(ctx: Context, config?: AutocompactConfig): void;
export {};
//# sourceMappingURL=index.d.ts.map