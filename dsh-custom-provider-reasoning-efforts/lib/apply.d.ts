/**
 * Write a planned change through the Harness settings service.
 *
 * This is the only writer. It reads the namespace's descriptor, plans against
 * the profile patch's own `providers` value, and calls `settings.update()` with
 * the whole planned value and the revision `describe()` returned, so the Loader
 * validates the candidate and reconciles the running `llm-pi-ai` adapter
 * exactly as it does a Models-page save — `providers` is a `volatile` field, so
 * the change is live without a restart. Nothing is written when the plan finds
 * no change, and a revision conflict is retried once against a fresh read.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/apply
 */
import { type Change, type Intent, type Skip } from "./plan.ts";
/** One configurable namespace as the settings service describes it. */
export interface ProviderDescriptor {
    /** Profile entry id addressed by the settings service. */
    readonly ns: string;
    /** Revision `describe()` returned; `update()` refuses a stale one. */
    readonly revision: number;
    /** The live resolved value, including provider defaults. */
    readonly value?: unknown;
    /** The profile patch's own raw value for this entry. */
    readonly user?: unknown;
}
/** The part of the settings service this plugin uses. */
export interface SettingsSeam {
    /** Whether the active profile accepts configuration edits. */
    readonly writable: boolean;
    /** Read the active namespaces with their revisions and layer values. */
    describe(): readonly ProviderDescriptor[];
    /** Write the namespace's volatile fields, guarded by the revision. */
    update(ns: string, patch: object, expectedRevision?: number): Promise<void>;
}
/** What one pass did. */
export interface ApplyResult {
    readonly kind: "applied" | "pending" | "unchanged" | "unavailable" | "readonly";
    readonly namespace: string;
    readonly changes: readonly Change[];
    readonly skipped: readonly Skip[];
}
/** One pass's inputs. */
export interface ApplyOptions {
    /** The configurable namespace whose `providers` field is written. */
    readonly namespace: string;
    /** The route/model pairs to apply. */
    readonly intents: readonly Intent[];
    /** Plan only; report the pending changes without writing. */
    readonly dryRun?: boolean;
}
/**
 * Plan and, unless `dryRun`, write one namespace's declared reasoning efforts.
 *
 * @param seam - the settings service, or a fake with the same shape.
 * @param options - the namespace, the intents, and whether to write.
 * @returns what the pass did, with the changes and the skips.
 * @throws Whatever `update()` rejected with, other than a revision conflict.
 */
export declare function applyIntents(seam: SettingsSeam, options: ApplyOptions): Promise<ApplyResult>;
//# sourceMappingURL=apply.d.ts.map