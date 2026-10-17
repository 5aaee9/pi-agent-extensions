/**
 * The plugin's pass: turn declarations and endpoint discovery into the
 * `providers` intents the settings write consumes.
 *
 * Everything here is transport- and service-agnostic so it can be driven by the
 * real Harness or by a fake with the same shape: the settings seam, the
 * credential seam, the logger, and the transport are injected, and the pass
 * reports what it probed, what it changed, what it skipped, and what failed
 * instead of throwing them away.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/runtime
 */
import type { SettingsSeam, ApplyResult } from "./apply.ts";
import { type Declarations } from "./declarations.ts";
/** The credential half of the credentials service this plugin uses. */
export interface CredentialSeam {
    /** Resolve one credential reference. */
    resolve(ref: string): Promise<{
        readonly value: string;
    } | undefined>;
}
/** The logger shape this plugin uses. */
export interface LoggerSeam {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
}
/** Everything the pass needs from its host. */
export interface RuntimeDeps {
    /** Resolve the settings seam per pass, so a late-mounted service is still seen. */
    readonly settings?: () => SettingsSeam | undefined;
    /** Resolve the credential seam per pass; absent means environment-only resolution. */
    readonly credentials?: () => CredentialSeam | undefined;
    readonly logger: LoggerSeam;
    /** Transport override, for tests. */
    readonly fetchImpl?: typeof fetch;
    /** Environment override, for tests; the process environment by default. */
    readonly env?: Readonly<Record<string, string | undefined>>;
}
/** The row configuration's resolved runtime inputs. */
export interface RuntimeOptions {
    /** The configurable namespace whose `providers` field is written. */
    readonly namespace: string;
    /** The validated declaration table. */
    readonly declarations: Declarations;
    /** Whether the load-time pass interrogates endpoints. */
    readonly discover: boolean;
    /** Routes to interrogate instead of the heuristic's own set. */
    readonly discoverRoutes: readonly string[];
}
/** One pass's mode. */
export type RunMode = "status" | "apply" | "discover" | "clear";
/** What one pass did. */
export interface RunSummary {
    readonly mode: RunMode;
    readonly namespace: string;
    readonly result: ApplyResult;
    /** How many route/model pairs the pass planned. */
    readonly intents: number;
    /** Routes whose endpoint was interrogated. */
    readonly probed: readonly string[];
    /** Routes whose interrogation failed, with the reason. */
    readonly failures: readonly string[];
}
/** The pass entry point. */
export interface Runtime {
    run(mode: RunMode, signal?: AbortSignal): Promise<RunSummary>;
}
/**
 * Render one pass's outcome as the command's answer.
 *
 * @param summary - the pass summary.
 * @returns the human-readable lines, one per finding.
 */
export declare function describeResult(summary: RunSummary): string;
/** How many times a load-time pass retries while its namespace is not reachable yet. */
export declare const LOAD_PASS_ATTEMPTS = 6;
/** Delay between load-time retries, in milliseconds. */
export declare const LOAD_PASS_RETRY_MS = 100;
/** One load-time pass's outcome: a summary, or the error it rejected with. */
export interface AttemptOutcome {
    readonly summary?: RunSummary;
    readonly error?: unknown;
}
/** How {@link runUntilAvailable} retries, and how it waits. */
export interface RetryOptions {
    readonly attempts?: number;
    readonly delayMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
}
/**
 * Run one pass, retrying while the namespace is not reachable.
 *
 * The Loader mounts every entry of a profile concurrently, so a plugin that
 * writes through another entry's configuration can observe that entry before
 * its fiber is active. A profile started by the standard launcher resolves this
 * with its readiness signal; this bounded retry is the fallback for a
 * composition that provides none. It stops at the first pass that is not
 * "unavailable", and it never repeats a pass whose work was already done.
 *
 * @param runtime - the pass to run.
 * @param mode - the mode to run it in.
 * @param options - the attempt budget and the wait between attempts.
 * @returns the last attempt's summary, or the error it rejected with.
 */
export declare function runUntilAvailable(runtime: Runtime, mode: RunMode, options?: RetryOptions): Promise<AttemptOutcome>;
/**
 * Build the pass for one resolved row configuration.
 *
 * @param options - the namespace, declarations, and discovery settings.
 * @param deps - the settings, credential, logger, and transport seams.
 * @returns the pass entry point.
 */
export declare function createRuntime(options: RuntimeOptions, deps: RuntimeDeps): Runtime;
//# sourceMappingURL=runtime.d.ts.map