# Proposal

## Why

Today an earlier compaction threshold must be listed model by model in `modelLimits`, so a
deployment whose catalog is large or changes often cannot say "compact every model early"
without editing YAML for each route. A single deployment-wide default threshold lets one
value cover every model, while a per-model value or a session command still takes
precedence.

## What Changes

- Add an optional row-configuration field `defaultLimit`: a positive integer token count
  applied to every model that has no threshold of its own. It is declared `.volatile()`
  like `modelLimits`, so the Settings page can edit it and a saved edit reaches the running
  plugin; absent means "no default" and autocompact stays off for uncovered models.
- Resolve the effective threshold as: session `/autocompact` override (an explicit `off`
  included) → the exact `provider/model` entry in `modelLimits` → `defaultLimit` → no
  threshold, which keeps autocompact off for that model.
- Add a **Default threshold** editor to the Settings section, above the per-model list:
  blank means unset, and saving writes `defaultLimit` or unsets it through the existing
  `settings.mutate` path operation.
- Make the composer status pill fall back to the default threshold for routes without a
  per-model entry, so every model shows the reading once a default is configured.
- Validate the default like every other threshold: a positive safe integer at load (a bad
  value fails the plugin load), and the existing retained-tail/context-window check at use.
- Update `README.md`, `CHANGELOG.md`, and the release intent; both build halves are rebuilt.

## Capabilities

### New Capabilities

None; this extends the capabilities this package already describes.

### Modified Capabilities

- `autocompact-thresholds`: adds the deployment-wide `defaultLimit` setting and its place
  in effective-threshold resolution.
- `autocompact-settings-section`: adds the editor for the default threshold and its
  set/unset write.
- `autocompact-status-pill`: the pill falls back to the default threshold for routes
  without a per-model threshold.

The package's capability specs still live in the unarchived `add-dsh-autocompact` change,
so `openspec/specs/` holds no baseline yet. The delta files therefore state the new
requirements as ADDED requirements under those same capability paths, at the paths and
organization that change already uses, so the two sets merge when both changes archive.

## Impact

- Host half: `index.ts` (Config schema, volatile read, resolution in the pressure check and
  the command), `settings.ts` (default resolution and validation).
- Client half: `src/client/contracts.ts`, `config-store.ts`, `state.ts`, `page.tsx`,
  `threshold-list.tsx` or a new default-threshold view, `dictionary.ts`, and
  `status-dock.tsx`.
- Tests: `test/settings.test.ts`, `test/index.test.ts`, `test/client.test.ts`.
- Documentation and release records: `README.md`, `CHANGELOG.md`, one release intent for
  `@indexyz/dsh-autocompact`; regenerated `lib/` and `client.js` (Git-ignored).
- No new dependency, host API, command grammar, or configuration file.
