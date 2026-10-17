/**
 * Read a provider endpoint's model listing into the reasoning levels it
 * advertises.
 *
 * The Harness's own discovery reads the same listing for a model's identity,
 * context window, and output cap; reasoning is the field it drops. This module
 * keeps that shape and adds the halves a declaration needs: the level names an
 * entry publishes and the mapping from a level name to the wire spelling the
 * gateway accepts. Only names that are pi-ai thinking levels survive, `off`
 * maps to `null` (dispatch sends nothing), and every other level maps to
 * itself, because a gateway's published effort name is the only spelling that
 * can be derived without guessing.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/reasoning
 */
import type { Efforts } from "./declarations.ts";
/** One model an endpoint listing advertises. */
export interface ListedModel {
    readonly id: string;
    /** The levels the entry advertises; absent when it advertises none. */
    readonly efforts?: Efforts;
}
/**
 * The reasoning levels one listing entry advertises.
 *
 * @param entry - one object-valued listing entry.
 * @returns the levels a declaration can carry, or `undefined` when the entry
 *   advertises none, cannot reason, or names only levels pi-ai does not know.
 */
export declare function effortsOf(entry: Record<string, unknown>): Efforts | undefined;
/**
 * Read one model-listing reply.
 *
 * The standard `data` array takes precedence; otherwise the enriched `models`
 * map some compatible gateways expose is read, with each property key as the
 * endpoint-facing id and the nested `id` as a fallback for an empty key.
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation.
 *
 * @param body - the parsed JSON reply.
 * @returns the advertised models in endpoint order.
 * @throws Error when the reply is not a model listing at all.
 */
export declare function readModelListing(body: unknown): ListedModel[];
//# sourceMappingURL=reasoning.d.ts.map