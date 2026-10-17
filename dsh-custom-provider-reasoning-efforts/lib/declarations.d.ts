/**
 * The declaration model this plugin supplies to a hand-written provider route.
 *
 * A route the installed pi-ai catalog does not ship has no catalog entry to
 * inherit reasoning capability from, so every one of its models resolves to
 * `reasoning: false` unless its `llm-pi-ai` profile entry carries
 * `reasoningEfforts`. This module is that field's authoring vocabulary: a
 * declaration names the pi-ai thinking levels a model offers and the wire
 * spelling each level dispatches, or says `false` for a model that cannot
 * reason at all.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/declarations
 */
/** One level's wire spelling; `null` is legal for `off` only and means dispatch sends nothing. */
export type EffortWire = string | null;
/** The levels one model offers, keyed by pi-ai thinking level. */
export type Efforts = Record<string, EffortWire>;
/** One model's declaration: the levels it offers, or `false` for a model that cannot reason. */
export type ModelDeclaration = false | Efforts;
/** Declarations keyed by provider route and then by exact model id. */
export type Declarations = Record<string, Record<string, ModelDeclaration>>;
/** A rejected declaration, naming the route, model, and level at fault. */
export declare class DeclarationError extends Error {
    constructor(message: string);
}
/**
 * Validate one model's declaration.
 *
 * A declaration is rejected when it is empty, offers no level beyond `off`,
 * carries `null` or an empty string on a level that is not `off`, or names a
 * key that is not a pi-ai thinking level. Every rejection names the route, the
 * model, and — where one is at fault — the level.
 *
 * @param route - provider route the declaration belongs to, for diagnostics.
 * @param model - exact model id the declaration belongs to, for diagnostics.
 * @param raw - the declaration as the row configuration carried it.
 * @returns the validated declaration.
 * @throws DeclarationError when the declaration cannot be served.
 */
export declare function validateModelDeclaration(route: string, model: string, raw: unknown): ModelDeclaration;
/**
 * Validate every declaration the row configuration carries, so a malformed
 * table fails the plugin's load instead of a later write.
 *
 * @param raw - the `providers` table as the row configuration carried it.
 * @returns the validated table.
 * @throws DeclarationError naming the first declaration that cannot be served.
 */
export declare function validateDeclarations(raw: Declarations | undefined): Declarations;
/**
 * Render a declaration's levels for a human-readable answer.
 *
 * @param value - one validated declaration.
 * @returns the levels in escalation order, or the non-reasoning marker.
 */
export declare function describeEfforts(value: ModelDeclaration): string;
//# sourceMappingURL=declarations.d.ts.map