# Design

## Context

`settings.ts` parses `piAutocompact.modelLimits` into `Map<"provider/model", number>` at `session_start`. `index.ts` keeps session overrides (`number | null`) and resolves `limitOf(key)` as override, else model default. `validateLimit` throws when the limit is not between `keepRecentTokens` and the context window; boundary and input checks report that throw as a warning.

## Goals / Non-Goals

Goals: provider and global caps, percentage values at every level, the minimum rule (`specs/`), and two new save flags.

Non-goals: project-level plugin settings, per-provider `off`, caps that raise a lower model threshold, and any change to native compaction settings.

## Decisions

### A limit value is a tagged union

`type LimitValue = { tokens: number } | { percent: number }`, parsed from the command (`300k`, `300000`, `80%`) and from settings (positive integer or `"80%"`). `resolveLimit(value, contextWindow)` returns `Math.floor(contextWindow * percent / 100)` or the token count. Percentages are kept unresolved in memory and in settings so one value fits models with different windows.

Alternative: store fractions such as `0.8` in JSON. Rejected because `1` would mean both one token and 100 %.

### Resolution is one pure function

`effectiveLimit({ override, model, provider, global }, contextWindow)` returns `{ tokens, source } | undefined`, where `source` is `"session" | "model" | "provider" | "global" | "window"`. `override === null` (`off`) returns `undefined`. The threshold candidate is the override if present, otherwise the model limit. Caps and the context window join the minimum only when at least one threshold or cap is defined. Ties keep the more specific source so status names the level the user set.

`index.ts` holds `PluginDefaults = { models, providers, global }` instead of the single map and calls this function in the boundary check, the input check, and the command.

### Unusable thresholds are skipped quietly

`usableLimit(tokens, contextWindow, keepRecentTokens)` replaces the runtime `validateLimit` call. The boundary and input checks return early when it reports unusable, so a broad global cap does not warn at every turn on small-window models. The command keeps rejecting an unusable explicit **session or model** threshold before it changes anything, as today. Provider and global saves only check the value's format and native enablement; the notification then states the effective result for the current model, including "not used: …" when unusable.

Trade-off: a hand-edited model limit at or above the window used to warn at each boundary; now it is silent and visible through `/autocompact`.

### Save flags select the target key

The parser returns `save: "model" | "provider" | "global" | undefined`. `withLimit(settings, target, value)` generalizes `withModelLimit` and writes `modelLimits[key]`, `providerLimits[provider]`, or `globalLimit`, serialized as an integer or `"<n>%"`. The existing lock, temp file, fsync, and rename path is reused unchanged. After a successful provider or global save the in-memory defaults are updated; the session override is left alone, so a `--save` model override in the same session still applies under the new cap.

## Risks / Trade-offs

- [A small global percentage disables plugin compaction on small-window models without notice] → status explains it, and the README documents the rule.
- [Existing `modelLimits` readers] → integer values parse exactly as before; only new string values need the new parser.

## Migration Plan

None. Existing settings are a subset of the new format. Rolling back to 0.2.x makes a percentage string in `modelLimits` a session-start error; the README notes this.
