/**
 * Plan the next `providers` value for the `llm-pi-ai` namespace.
 *
 * The plan operates on the profile patch's own raw providers value (the lean
 * layer a Models-page save also edits), never on the resolved configuration, so
 * a write adds only the declared fields instead of materializing every provider
 * default. Nothing is invented: an intent lands only when the profile already
 * declares the route with an explicit `models` list and that list already
 * declares the model, and every other intent is reported as a skip with the
 * reason it could not land.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/plan
 */
import type { ModelDeclaration } from "./declarations.ts";
/** One route/model pair the plugin wants the configuration to carry. */
export interface Intent {
    readonly route: string;
    readonly model: string;
    /** The declaration to write; `undefined` removes the field. */
    readonly value: ModelDeclaration | undefined;
}
/** One field the plan would change. */
export interface Change {
    readonly route: string;
    readonly model: string;
    /** The field's current value, or `undefined` when the entry carries none. */
    readonly before: unknown;
    /** The field's planned value, or `undefined` when it is removed. */
    readonly after: ModelDeclaration | undefined;
}
/** One intent that cannot land, with the reason. */
export interface Skip {
    readonly route: string;
    readonly model: string;
    readonly reason: string;
}
/** The planned providers value and what the plan did with every intent. */
export interface PlanResult {
    /** The next `providers` value, or `undefined` when the profile carries none. */
    readonly providers: Record<string, unknown> | undefined;
    readonly changes: readonly Change[];
    readonly skipped: readonly Skip[];
}
/**
 * Compute the next `providers` value for one namespace's user layer.
 *
 * @param user - the descriptor's `user` value (the profile patch's own raw config).
 * @param intents - the route/model pairs to write, or remove when `value` is `undefined`.
 * @returns the planned providers value, the changes, and the skips.
 */
export declare function planProviders(user: unknown, intents: readonly Intent[]): PlanResult;
//# sourceMappingURL=plan.d.ts.map