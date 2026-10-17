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
import { isDeepStrictEqual } from "node:util";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Compute the next `providers` value for one namespace's user layer.
 *
 * @param user - the descriptor's `user` value (the profile patch's own raw config).
 * @param intents - the route/model pairs to write, or remove when `value` is `undefined`.
 * @returns the planned providers value, the changes, and the skips.
 */
export function planProviders(user, intents) {
    const carried = isRecord(user) ? user["providers"] : undefined;
    const providers = isRecord(carried)
        ? structuredClone(carried)
        : undefined;
    const changes = [];
    const skipped = [];
    if (providers === undefined) {
        for (const intent of intents) {
            skipped.push({
                route: intent.route,
                model: intent.model,
                reason: "the profile carries no providers table for this namespace",
            });
        }
        return { providers: undefined, changes, skipped };
    }
    for (const intent of intents) {
        const route = providers[intent.route];
        if (!isRecord(route)) {
            skipped.push({
                route: intent.route,
                model: intent.model,
                reason: `the profile does not declare route "${intent.route}"`,
            });
            continue;
        }
        const models = route["models"];
        if (!Array.isArray(models)) {
            skipped.push({
                route: intent.route,
                model: intent.model,
                reason: `route "${intent.route}" declares no explicit models list, so its models come from the installed catalog`,
            });
            continue;
        }
        const index = models.findIndex((entry) => isRecord(entry) && entry["id"] === intent.model);
        const entry = index < 0 ? undefined : models[index];
        if (!isRecord(entry)) {
            skipped.push({
                route: intent.route,
                model: intent.model,
                reason: `route "${intent.route}" does not declare model "${intent.model}"`,
            });
            continue;
        }
        const before = Object.hasOwn(entry, "reasoningEfforts")
            ? entry["reasoningEfforts"]
            : undefined;
        if (isDeepStrictEqual(before, intent.value))
            continue;
        const next = { ...entry };
        if (intent.value === undefined)
            Reflect.deleteProperty(next, "reasoningEfforts");
        else
            next["reasoningEfforts"] = intent.value;
        models[index] = next;
        changes.push({
            route: intent.route,
            model: intent.model,
            before,
            after: intent.value,
        });
    }
    return { providers, changes, skipped };
}
//# sourceMappingURL=plan.js.map