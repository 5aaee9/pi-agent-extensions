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
import { planProviders } from "./plan.js";
/** Whether an error is the settings service's revision conflict. */
function isConflict(error) {
    if (error === null || typeof error !== "object")
        return false;
    if (Reflect.get(error, "name") === "SettingsConflictError")
        return true;
    return Reflect.get(error, "code") === "SETTINGS_CONFLICT";
}
function descriptorFor(seam, namespace) {
    return seam.describe().find((entry) => entry.ns === namespace);
}
/**
 * Plan and, unless `dryRun`, write one namespace's declared reasoning efforts.
 *
 * @param seam - the settings service, or a fake with the same shape.
 * @param options - the namespace, the intents, and whether to write.
 * @returns what the pass did, with the changes and the skips.
 * @throws Whatever `update()` rejected with, other than a revision conflict.
 */
export async function applyIntents(seam, options) {
    const namespace = options.namespace;
    if (!seam.writable)
        return { kind: "readonly", namespace, changes: [], skipped: [] };
    let descriptor = descriptorFor(seam, namespace);
    if (descriptor === undefined) {
        return { kind: "unavailable", namespace, changes: [], skipped: [] };
    }
    let plan = planProviders(descriptor.user, options.intents);
    if (plan.changes.length === 0) {
        return { kind: "unchanged", namespace, changes: [], skipped: plan.skipped };
    }
    if (options.dryRun === true) {
        return { kind: "pending", namespace, changes: plan.changes, skipped: plan.skipped };
    }
    try {
        await seam.update(namespace, { providers: plan.providers }, descriptor.revision);
    }
    catch (error) {
        if (!isConflict(error))
            throw error;
        descriptor = descriptorFor(seam, namespace);
        if (descriptor === undefined) {
            return { kind: "unavailable", namespace, changes: [], skipped: plan.skipped };
        }
        plan = planProviders(descriptor.user, options.intents);
        if (plan.changes.length === 0) {
            return { kind: "unchanged", namespace, changes: [], skipped: plan.skipped };
        }
        await seam.update(namespace, { providers: plan.providers }, descriptor.revision);
    }
    return { kind: "applied", namespace, changes: plan.changes, skipped: plan.skipped };
}
//# sourceMappingURL=apply.js.map