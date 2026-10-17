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
import { isThinkingLevel } from "./levels.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The first non-empty string among the candidates. */
function label(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0)
            return candidate;
    }
    return undefined;
}
/** Push the level names one field carries, accepting string and object entries. */
function pushLevels(into, raw) {
    if (!Array.isArray(raw))
        return;
    for (const item of raw) {
        if (typeof item === "string") {
            into.push(item);
            continue;
        }
        if (!isRecord(item))
            continue;
        const name = label(item["effort"], item["level"], item["id"], item["name"]);
        if (name !== undefined)
            into.push(name);
    }
}
/** Every level name an entry publishes, across the spellings gateways use. */
function levelNames(entry) {
    const names = [];
    pushLevels(names, entry["supported_reasoning_levels"]);
    pushLevels(names, entry["reasoning_levels"]);
    pushLevels(names, entry["supported_reasoning_efforts"]);
    const reasoning = entry["reasoning"];
    if (isRecord(reasoning)) {
        pushLevels(names, reasoning["efforts"]);
        pushLevels(names, reasoning["supported_efforts"]);
    }
    return names;
}
/**
 * The reasoning levels one listing entry advertises.
 *
 * @param entry - one object-valued listing entry.
 * @returns the levels a declaration can carry, or `undefined` when the entry
 *   advertises none, cannot reason, or names only levels pi-ai does not know.
 */
export function effortsOf(entry) {
    if (entry["reasoning"] === false)
        return undefined;
    const efforts = {};
    let thinking = 0;
    for (const name of levelNames(entry)) {
        if (!isThinkingLevel(name))
            continue;
        if (name === "off") {
            efforts["off"] = null;
            continue;
        }
        efforts[name] = name;
        thinking += 1;
    }
    return thinking === 0 ? undefined : efforts;
}
/**
 * Read one Codex-shaped capability manifest.
 *
 * A Sub2API-style relay answers `/backend-api/codex/models` with a `models`
 * array whose entries carry the upstream backend's slug and the efforts that
 * backend accepts under `supported_reasoning_levels` — the capability its
 * `/v1/models` inventory does not publish. A body that is not such a manifest
 * yields `undefined`, so a relay without the endpoint is not an error.
 *
 * @param body - the parsed JSON reply.
 * @returns the advertised models in manifest order, or `undefined` when the
 *   body is not a manifest.
 */
export function readManifestListing(body) {
    if (!isRecord(body))
        return undefined;
    const listed = body["models"];
    if (!Array.isArray(listed))
        return undefined;
    const models = [];
    for (const raw of listed) {
        if (!isRecord(raw))
            continue;
        const id = label(raw["slug"], raw["id"]);
        if (id === undefined)
            continue;
        const efforts = effortsOf(raw);
        models.push(efforts === undefined ? { id } : { id, efforts });
    }
    return models;
}
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
export function readModelListing(body) {
    if (!isRecord(body))
        throw new Error("the endpoint's model listing is not a JSON object");
    const listed = [];
    const data = body["data"];
    if (Array.isArray(data)) {
        for (const raw of data)
            if (isRecord(raw))
                listed.push({ key: undefined, raw });
    }
    else {
        const models = body["models"];
        if (!isRecord(models)) {
            throw new Error('the endpoint\'s model listing has neither a "data" array nor a "models" object');
        }
        for (const [key, raw] of Object.entries(models)) {
            if (isRecord(raw))
                listed.push({ key, raw });
        }
    }
    const models = [];
    for (const { key, raw } of listed) {
        const id = label(key, raw["id"]);
        if (id === undefined)
            continue;
        const efforts = effortsOf(raw);
        models.push(efforts === undefined ? { id } : { id, efforts });
    }
    return models;
}
//# sourceMappingURL=reasoning.js.map