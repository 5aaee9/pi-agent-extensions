# Design

## Context

See `proposal.md` — Why. The relevant current state:

- The Host half resolves one effective threshold in two places through the shared
  `resolveLimit(overrides, defaults, key)` helper in `settings.ts`: the `agent/pre-step`
  pressure check and the `/autocompact` command handler. Session overrides live in a
  `WeakMap<Session, Map<string, number | null>>`, where `null` is an explicit `off`.
- `Config` already declares `modelLimits` and `enabled` as `.volatile()` fields and the
  Loader hands `apply` live references for them; `liveValue` re-reads a field on every use.
  This is what makes a Settings save reach the running plugin.
- The client half reads the row through `settings.describe()`, keeps one snapshot in
  `config-store.ts` for the Settings page and the status pill, and writes through
  `settings.update` / `settings.mutate(ns, ops, revision)` with `{ op: "set" | "unset",
path, value }`.
- The status pill resolves the route's persisted threshold from the snapshot's
  `limits[route]` and takes no seat when it is absent.

## Goals / Non-Goals

**Goals:**

- One deployment default covers every model that has no `modelLimits` entry, with a single
  precedence rule shared by the pressure check, the command, and the client reading.
- The default is a first-class Settings value: set, edit, and clear it without YAML, and
  have the running plugin see the change without a restart.
- Nothing changes for a deployment that does not set the default.

**Non-Goals:**

- Persisting session overrides, changing the `/autocompact` grammar, or writing the
  default from the command.
- Relaxing per-route validation: a default that does not fit a route stays inert for that
  route rather than being clamped or silently skipped forever.
- Replacing or reconfiguring the backend's own compaction.

## Decisions

### 1. The field is `defaultLimit`, optional and volatile

**Choice:** `Config` gains `defaultLimit: z.natural().volatile()` with no `.default()`, so
an absent field parses to `Volatile<undefined>` and `get()` answers `undefined`. The
fallback value in `apply` is `undefined`.

**Why:** a default of "unset" cannot be represented by `0` (it would trigger on every
request) or by a sentinel, so the field must be optional. `.volatile()` is required for
three reasons the existing fields already rely on: the Host settings service only lists
rows that declare a volatile field, only accepts writes to volatile paths, and only
volatile references make a saved edit visible without restarting the plugin.

**Alternative considered:** reuse `modelLimits` with a `*/*` wildcard key. Rejected: the
existing map validates every key as an exact `provider/model`, a wildcard would need a
second grammar, and a model literally named `*` would collide.

**Alternative considered:** `.default(0)` meaning "off". Rejected: it makes the settings
form show a value that is not a threshold, and every consumer would need to special-case
zero.

### 2. One precedence rule, in `resolveLimit`

**Choice:** extend the helper to `resolveLimit(overrides, defaults, key, defaultLimit?)`:
a session key wins even when its value is `null` (explicit `off`), otherwise
`defaults.get(key) ?? defaultLimit`, otherwise `undefined`. Both the pressure check and the
command call this helper with the same `defaultLimit` value; the client mirrors the same
rule with `limits[route] ?? defaultLimit`.

**Why:** the rule is the feature. Keeping it in one Host helper means the command's report
and the compaction decision cannot drift, and the client mirror is a two-line expression
whose tests pin the same order.

**Alternative considered:** materialize the default into every route at resolve time
(e.g., a merged map). Rejected: it would make "which setting supplied this threshold"
unanswerable in the command report, and it would have to be rebuilt on every edit.

### 3. Validate the default at load and at use

**Choice:** `defaultLimit` is validated at load with the same positive-safe-integer rule as
`modelLimits` entries, so `0`, a negative, a fraction, or a non-number fails the plugin
load. At use, the existing `validateLimit(limit, contextWindow, retainTokens)` check still
runs; a default that is too large for a route throws inside `checkPressure`, which the
existing `agent/pre-step` catch turns into a once-per-session warning and leaves the turn
untouched.

**Why:** load-time validation catches an edited YAML row loudly; use-time validation is
the only place the route's real window and retained tail are known. A deployment-wide
default legitimately may not fit every model, so failing the whole plugin for that would be
too strict — the session warns and other routes keep working.

### 4. The Settings page edits the default above the model list

**Choice:** a dedicated card, above the existing per-model card: a label, a hint that says
the default applies to models without their own threshold and that blank means off, and a
`300k`-grammar input. The page keeps a `defaultDraft` string beside the per-model `draft`
and derives dirtiness from it. On save it emits `unset ["defaultLimit"]` for a blank field
that had a value, `set ["defaultLimit"]` for a parsed value that differs, then the existing
per-model operations, all in the same revision-guarded `mutate` call. An unparsable value
writes nothing.

**Why:** the per-model list is a list of exceptions; a default is a different kind of
value, so it gets its own row instead of a synthetic entry in the list. Bundling the
default operation into the same `mutate` keeps one revision guard and one conflict path for
the whole save.

**Alternative considered:** add the default through `settings.update({ defaultLimit })`
separately. Rejected: two writes could half-apply, and the page already has one save flow
with one conflict handler.

### 5. The status pill falls back to the default

**Choice:** the pill computes `snapshot.config.limits[route] ?? snapshot.config.defaultLimit`.
The master-switch-off branch stays first, and the "no threshold → no seat" branch now fires
only when both are absent.

**Why:** with a deployment default configured, every model really does compact early, so a
pill that stayed empty for uncovered models would be wrong. The reading keeps reporting the
persisted value (not a session override), as before.

### 6. No backend, command, or grammar change

**Choice:** the `/autocompact` command grammar stays `300k | off | default`; its report
labels the source `session`, `global default` (a `modelLimits` entry), or `deployment
default` (the new fallback). The backend's own compaction remains untouched.

**Why:** the feature is a configuration fallback, not a new command surface; an explicit
`off` must keep suppressing both persisted layers, which it already does.

## Risks / Trade-offs

- **A default that exceeds a route's context window** → that route warns once per session
  and other routes keep compacting; the Settings page accepts the value because it is
  deployment-wide. Documented in the README and in the error text.
- **A default applied to a newly added model can change behavior without a per-model edit**
  → that is the feature; an explicit per-model value or `off` remains the escape hatch.
- **One more volatile field changes the settings form the Host derives** → the field is
  optional, so an untouched profile describes exactly the same values as before.
- **Client and Host resolve the precedence independently** → the rule is two expressions,
  pinned by tests on both sides and stated once in the specs.

## Migration Plan

No migration: the field is absent by default, so an existing profile keeps the current
behavior until someone sets `defaultLimit` in Settings or in `cordis.patch.yml`. Rolling
back is deleting the field (or the Settings value); no session or backend state depends on
it.
