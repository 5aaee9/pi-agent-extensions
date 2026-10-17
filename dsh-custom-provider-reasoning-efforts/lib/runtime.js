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
import { applyIntents } from "./apply.js";
import { describeEfforts } from "./declarations.js";
import { hasCodexManifest, probeManifest, probeRoute } from "./discovery.js";
/** How many lines of changes or skips one answer lists before summarizing. */
const MAX_LISTED = 5;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The `providers` table one descriptor layer carries, when it carries one. */
function providersOf(value) {
    if (!isRecord(value))
        return undefined;
    const providers = value["providers"];
    return isRecord(providers) ? providers : undefined;
}
/** The model ids one route's explicit `models` list declares. */
function declaredModelIds(route) {
    const ids = new Set();
    const models = route?.["models"];
    if (Array.isArray(models)) {
        for (const entry of models) {
            if (isRecord(entry) && typeof entry["id"] === "string")
                ids.add(entry["id"]);
        }
    }
    return ids;
}
/** A string-valued record, or `undefined` when the value is not one. */
function stringRecord(value) {
    if (!isRecord(value))
        return undefined;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string")
            result[key] = entry;
    }
    return Object.keys(result).length === 0 ? undefined : result;
}
/** Every declared route/model pair, with its declaration. */
function declaredIntents(declarations) {
    const intents = [];
    for (const [route, models] of Object.entries(declarations)) {
        for (const [model, value] of Object.entries(models))
            intents.push({ route, model, value });
    }
    return intents;
}
/** Every declared route/model pair, as a removal. */
function removalIntents(declarations) {
    const intents = [];
    for (const [route, models] of Object.entries(declarations)) {
        for (const model of Object.keys(models)) {
            intents.push({ route, model, value: undefined });
        }
    }
    return intents;
}
/** An explicit declaration wins over a discovered one for the same pair. */
function mergeIntents(explicit, discovered) {
    const merged = new Map();
    for (const intent of [...discovered, ...explicit]) {
        merged.set(`${intent.route}\u0000${intent.model}`, intent);
    }
    return [...merged.values()];
}
/**
 * The routes a discovery pass interrogates.
 *
 * The heuristic's set is the profile's own hand-written routes: those that
 * declare an explicit, non-empty `models` list and a `baseURL`. A non-empty
 * `discoverRoutes` names the set instead.
 */
function candidateRoutes(options, user, effective) {
    if (options.discoverRoutes.length > 0)
        return [...options.discoverRoutes];
    const routes = [];
    for (const [route, entry] of Object.entries(user ?? {})) {
        if (!isRecord(entry))
            continue;
        if (declaredModelIds(entry).size === 0)
            continue;
        const resolved = isRecord(effective?.[route]) ? effective[route] : entry;
        const baseURL = resolved["baseURL"];
        if (typeof baseURL !== "string" || baseURL.length === 0)
            continue;
        routes.push(route);
    }
    return routes;
}
/** Resolve one route's credential reference, through the store and then the environment. */
async function resolveApiKey(deps, ref) {
    if (typeof ref !== "string" || ref.length === 0)
        return undefined;
    const credentials = deps.credentials?.();
    if (credentials !== undefined) {
        try {
            const resolved = await credentials.resolve(ref);
            if (resolved !== undefined && resolved.value.length > 0)
                return resolved.value;
        }
        catch (error) {
            deps.logger.warn(`could not resolve the credential ${ref}: ${message(error)}`);
        }
    }
    const value = (deps.env ?? process.env)[ref];
    return value !== undefined && value.length > 0 ? value : undefined;
}
/**
 * Whether a route's own listing left something for its Codex manifest to answer.
 *
 * The manifest costs a second request, so it is consulted only when the listing
 * described no thinking level for at least one model the route declares — the
 * state a Codex relay that publishes no capability in `/v1/models` is in.
 */
function needsManifest(api, listed, declared) {
    if (!hasCodexManifest(api) || declared.size === 0)
        return false;
    const levelled = new Set(listed.filter((model) => model.efforts !== undefined).map((model) => model.id));
    for (const id of declared)
        if (!levelled.has(id))
            return true;
    return false;
}
/**
 * Merge a manifest's models into a listing's.
 *
 * A model the listing already describes keeps its own wire spellings and gains
 * the manifest's additional levels; a model only the manifest describes is
 * added, so an inventory that omits a model does not hide the manifest's answer
 * for it.
 */
function mergeListings(listed, manifest) {
    const merged = new Map();
    for (const model of listed)
        merged.set(model.id, model);
    for (const model of manifest) {
        const existing = merged.get(model.id);
        if (existing === undefined) {
            merged.set(model.id, model);
            continue;
        }
        if (model.efforts === undefined)
            continue;
        merged.set(model.id, { id: model.id, efforts: { ...model.efforts, ...existing.efforts } });
    }
    return [...merged.values()];
}
/** Interrogate every candidate route and turn the advertised levels into intents. */
async function discoverIntents(deps, options, descriptor, signal) {
    const user = providersOf(descriptor.user);
    const effective = providersOf(descriptor.value) ?? user;
    const intents = [];
    const probed = [];
    const failures = [];
    for (const route of candidateRoutes(options, user, effective)) {
        probed.push(route);
        const userRoute = isRecord(user?.[route]) ? user[route] : undefined;
        const effectiveRoute = isRecord(effective?.[route]) ? effective[route] : undefined;
        const profile = effectiveRoute ?? userRoute;
        if (profile === undefined) {
            failures.push(`${route}: the namespace does not declare that route`);
            continue;
        }
        const baseURL = profile["baseURL"];
        if (typeof baseURL !== "string" || baseURL.length === 0) {
            failures.push(`${route}: the route declares no baseURL to interrogate`);
            continue;
        }
        const api = typeof profile["api"] === "string" && profile["api"].length > 0
            ? profile["api"]
            : "openai-completions";
        const headers = stringRecord(profile["headers"]);
        const apiKey = await resolveApiKey(deps, profile["apiKeyEnv"]);
        const declared = declaredModelIds(userRoute);
        const probe = {
            route,
            baseURL,
            api,
            signal,
            fetchImpl: deps.fetchImpl,
            ...(apiKey === undefined ? {} : { apiKey }),
            ...(headers === undefined ? {} : { headers }),
        };
        let listed;
        try {
            listed = await probeRoute(probe);
        }
        catch (error) {
            failures.push(`${route}: ${message(error)}`);
            continue;
        }
        if (needsManifest(api, listed, declared)) {
            try {
                const manifest = await probeManifest(probe);
                if (manifest !== undefined)
                    listed = mergeListings(listed, manifest);
            }
            catch (error) {
                failures.push(`${route}: ${message(error)}`);
            }
        }
        for (const model of listed) {
            if (model.efforts === undefined)
                continue;
            if (!declared.has(model.id))
                continue;
            intents.push({ route, model: model.id, value: model.efforts });
        }
    }
    return { intents, probed, failures };
}
/** One change rendered for an answer. */
function describeChange(change) {
    const after = change.after;
    return `${change.route}/${change.model} -> ${after === undefined ? "removed" : describeEfforts(after)}`;
}
/** A skip rendered for an answer. */
function describeSkip(skip) {
    return `skipped ${skip.route}/${skip.model}: ${skip.reason}`;
}
/**
 * Render one pass's outcome as the command's answer.
 *
 * @param summary - the pass summary.
 * @returns the human-readable lines, one per finding.
 */
export function describeResult(summary) {
    const { result, namespace } = summary;
    if (result.kind === "unavailable") {
        return `reasoning-efforts: no configurable "${namespace}" entry is mounted, so there is nothing to declare`;
    }
    if (result.kind === "readonly") {
        return "reasoning-efforts: the active profile does not accept configuration edits";
    }
    const unchanged = Math.max(summary.intents - result.changes.length - result.skipped.length, 0);
    const lines = [];
    if (summary.mode === "status") {
        lines.push(`reasoning-efforts: ${String(result.changes.length)} pending change(s) for "${namespace}" (${String(unchanged)} already current)`);
    }
    else if (result.kind === "unchanged") {
        lines.push(`reasoning-efforts: nothing to change in "${namespace}" (${String(unchanged)} already current)`);
    }
    else {
        lines.push(`reasoning-efforts: applied ${String(result.changes.length)} change(s) to "${namespace}" (${String(unchanged)} already current)`);
    }
    for (const change of result.changes.slice(0, MAX_LISTED))
        lines.push(`  ${describeChange(change)}`);
    if (result.changes.length > MAX_LISTED) {
        lines.push(`  … and ${String(result.changes.length - MAX_LISTED)} more`);
    }
    for (const skip of result.skipped.slice(0, MAX_LISTED))
        lines.push(`  ${describeSkip(skip)}`);
    if (result.skipped.length > MAX_LISTED) {
        lines.push(`  … and ${String(result.skipped.length - MAX_LISTED)} more skipped`);
    }
    if (summary.mode === "discover" && summary.probed.length === 0) {
        lines.push("  nothing to interrogate: no route declares an explicit models list and a baseURL");
    }
    for (const failure of summary.failures)
        lines.push(`  discovery failed: ${failure}`);
    return lines.join("\n");
}
/** How many times a load-time pass retries while its namespace is not reachable yet. */
export const LOAD_PASS_ATTEMPTS = 6;
/** Delay between load-time retries, in milliseconds. */
export const LOAD_PASS_RETRY_MS = 100;
function defaultSleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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
export async function runUntilAvailable(runtime, mode, options = {}) {
    const attempts = Math.max(options.attempts ?? LOAD_PASS_ATTEMPTS, 1);
    const delayMs = options.delayMs ?? LOAD_PASS_RETRY_MS;
    const sleep = options.sleep ?? defaultSleep;
    let last = {};
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const summary = await runtime.run(mode);
            if (summary.result.kind !== "unavailable")
                return { summary };
            last = { summary };
        }
        catch (error) {
            last = { error };
        }
        if (attempt < attempts)
            await sleep(delayMs);
    }
    return last;
}
/**
 * Build the pass for one resolved row configuration.
 *
 * @param options - the namespace, declarations, and discovery settings.
 * @param deps - the settings, credential, logger, and transport seams.
 * @returns the pass entry point.
 */
export function createRuntime(options, deps) {
    const run = async (mode, signal) => {
        const namespace = options.namespace;
        const seam = deps.settings?.();
        if (seam === undefined) {
            return {
                mode,
                namespace,
                result: { kind: "unavailable", namespace, changes: [], skipped: [] },
                intents: 0,
                probed: [],
                failures: [],
            };
        }
        let intents = mode === "clear"
            ? removalIntents(options.declarations)
            : declaredIntents(options.declarations);
        let probed = [];
        let failures = [];
        if (mode === "discover") {
            const descriptor = seam.describe().find((entry) => entry.ns === namespace);
            if (descriptor === undefined) {
                return {
                    mode,
                    namespace,
                    result: { kind: "unavailable", namespace, changes: [], skipped: [] },
                    intents: 0,
                    probed,
                    failures,
                };
            }
            const discovery = await discoverIntents(deps, options, descriptor, signal);
            intents = mergeIntents(intents, discovery.intents);
            probed = discovery.probed;
            failures = discovery.failures;
        }
        const result = await applyIntents(seam, {
            namespace,
            intents,
            dryRun: mode === "status",
        });
        return { mode, namespace, result, intents: intents.length, probed, failures };
    };
    return { run };
}
//# sourceMappingURL=runtime.js.map