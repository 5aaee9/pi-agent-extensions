/**
 * Declare reasoning efforts for hand-written dsh provider routes.
 *
 * A provider route the installed pi-ai catalog does not ship inherits no
 * reasoning capability, so `llm-pi-ai` resolves every one of its models to
 * `reasoning: false` and the model-selection menu offers no levels — even when
 * the gateway itself advertises them. The only field that fixes that is the
 * route model entry's `reasoningEfforts`, and the only seam through which
 * another plugin can supply it is the `volatile` `providers` field of the
 * `llm-pi-ai` row, written through the Harness settings service.
 *
 * This plugin owns that write. Declarations live in its own row configuration
 * (`providers`), and `/reasoning-efforts` plans or applies them; when a route
 * declares its levels at `/v1/models`, a discovery pass reads them and fills
 * the same field. An explicit declaration always wins over a discovered one,
 * and nothing is invented: a route or model the profile does not already
 * declare is reported and skipped.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { type Declarations } from "./declarations.ts";
/** Plugin identity used by the Loader and by diagnostics. */
export declare const name = "custom-provider-reasoning-efforts";
/** Host-plane services this plugin needs before it can register its command. */
export declare const inject: string[];
/**
 * Row configuration as `apply` receives it.
 *
 * `providers` is the declaration table; the rest tune the passes.
 */
export interface ReasoningEffortsConfig {
    /** Declarations keyed by provider route and then by exact model id. */
    providers?: Declarations;
    /** Whether the load-time pass interrogates endpoints (default true). */
    discover?: boolean;
    /** Routes to interrogate instead of the heuristic's own set (default: none). */
    discoverRoutes?: readonly string[];
    /** The configurable namespace whose `providers` field is written (default `llm-pi-ai`). */
    namespace?: string;
    /** Whether the load-time pass writes at all (default true). */
    applyOnLoad?: boolean;
}
/**
 * Validated row configuration; a malformed declaration fails plugin load.
 *
 * The declaration table keeps the same value grammar `llm-pi-ai` itself
 * accepts for `reasoningEfforts`: an effort dict, or `false` for a model that
 * cannot reason. Its levels are validated semantically by
 * {@link validateDeclarations}, because a dict's keys are not schema-constrained.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    providers: z<import("@deepseek-ai/cosmokit").Dict<import("@deepseek-ai/cosmokit").Dict<false | import("@deepseek-ai/cosmokit").Dict<string | null, string>, string>, string>, import("@deepseek-ai/cosmokit").Dict<import("@deepseek-ai/cosmokit").Dict<false | import("@deepseek-ai/cosmokit").Dict<string | null, string>, string>, string>, "defined">;
    discover: z<boolean, boolean, "defined">;
    discoverRoutes: z<string[], string[], "defined">;
    namespace: z<string, string, "defined">;
    applyOnLoad: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    providers: z<import("@deepseek-ai/cosmokit").Dict<import("@deepseek-ai/cosmokit").Dict<false | import("@deepseek-ai/cosmokit").Dict<string | null, string>, string>, string>, import("@deepseek-ai/cosmokit").Dict<import("@deepseek-ai/cosmokit").Dict<false | import("@deepseek-ai/cosmokit").Dict<string | null, string>, string>, string>, "defined">;
    discover: z<boolean, boolean, "defined">;
    discoverRoutes: z<string[], string[], "defined">;
    namespace: z<string, string, "defined">;
    applyOnLoad: z<boolean, boolean, "defined">;
}>>, "plain">;
/**
 * Register the `/reasoning-efforts` command and the load-time pass.
 *
 * @param ctx - Host-plane context carrying the command registry.
 * @param config - validated row configuration; a malformed declaration throws here.
 */
export declare function apply(ctx: Context, config?: ReasoningEffortsConfig): void;
//# sourceMappingURL=index.d.ts.map