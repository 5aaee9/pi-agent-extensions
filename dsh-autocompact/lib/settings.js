/**
 * Threshold parsing, global defaults, validation, and read-only introspection
 * of the mounted compaction backend's native retention policy.
 *
 * Nothing in this module writes configuration: the command only keeps an
 * in-memory session map, exactly like `pi-autocompact` never writes settings.
 *
 * @module @indexyz/dsh-autocompact/settings
 */
/** One exact `provider/model` route key, the unit every threshold is keyed by. */
export function modelKey(provider, model) {
    return `${provider}/${model}`;
}
/** Reject a non-object configuration value, tolerating `undefined` for absent sections. */
export function object(value, label) {
    if (value === undefined)
        return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
/**
 * Parse `300k`, `0.3m`, or `300000` into a positive safe integer token count.
 * `k`/`m` are decimal units, matching the reference extension.
 */
export function parseLimit(input) {
    const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(input.trim());
    if (!match)
        throw new Error("Usage: /autocompact [300k | 1m | 300000 | off | default]");
    const limit = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error("Threshold must be a positive safe integer number of tokens");
    }
    return limit;
}
/**
 * Validate one absolute threshold against the recent-tail budget the compaction
 * backend will keep verbatim and against the real model context window.
 */
export function validateLimit(limit, contextWindow, retainTokens) {
    if (!Number.isSafeInteger(limit) || limit <= retainTokens) {
        throw new Error(`Threshold must be an integer greater than the retained token budget (${retainTokens})`);
    }
    if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 || limit >= contextWindow) {
        throw new Error(`Threshold must be less than the model context window (${contextWindow})`);
    }
}
/**
 * Optional global defaults from this plugin's own `config`; the command never
 * writes them and a session command overrides them without persisting anything.
 */
export function defaultLimits(config) {
    const models = object(config.modelLimits, "autocompact.modelLimits");
    return new Map(Object.entries(models).map(([key, value]) => {
        if (!key.includes("/") ||
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value <= 0) {
            throw new Error(`Invalid autocompact.modelLimits entry: ${key}`);
        }
        return [key, value];
    }));
}
/**
 * Resolve the effective absolute threshold for one route: a session override
 * always wins, including an explicit `null` that suppresses a global default.
 */
export function resolveLimit(overrides, defaults, key) {
    return overrides.has(key) ? (overrides.get(key) ?? undefined) : defaults.get(key);
}
/**
 * Read the mounted backend's native policy without depending on a concrete
 * backend package. Any engine that does not publish a `config` object simply
 * yields `undefined`, and the plugin then uses its own fallback budget.
 */
export function nativePolicy(engine) {
    if (!engine || typeof engine !== "object")
        return undefined;
    const config = engine.config;
    if (!config || typeof config !== "object" || Array.isArray(config))
        return undefined;
    return config;
}
/**
 * Whether the mounted backend still performs automatic compaction. An absent
 * policy counts as enabled, so unknown backends keep working.
 */
export function nativeAutoEnabled(engine) {
    return nativePolicy(engine)?.auto !== false;
}
/**
 * Whether the mounted backend supports compacting an explicit surface region,
 * which is the capability an earlier threshold is expressed through.
 */
export function supportsRegions(engine) {
    return typeof engine?.compactRegion === "function";
}
function tokenCount(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        return undefined;
    return value;
}
/**
 * Resolve the recent-tail budget for one exact route the same way the native
 * backend's `resolveCompactSpec` does: an exact `provider/model` policy wins,
 * then the backend default, and the plugin fallback applies only when the
 * backend publishes no usable retention policy at all.
 */
export function nativeRetainTokens(policy, provider, model, contextWindow, reservedCompletionTokens, fallback) {
    const override = policy?.modelPolicies?.find((entry) => entry.provider === provider && entry.model === model);
    const absolute = tokenCount(override?.retainTokens) ?? tokenCount(policy?.retainTokens);
    if (absolute !== undefined)
        return absolute;
    const ratio = override?.retainRatio ?? policy?.retainRatio;
    const messageBudget = contextWindow - reservedCompletionTokens;
    if (typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && messageBudget > 0) {
        return Math.floor(messageBudget * ratio);
    }
    return fallback;
}
//# sourceMappingURL=settings.js.map