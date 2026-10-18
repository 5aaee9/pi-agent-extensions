# Changelog

## 0.2.0

### Minor Changes

- Add a deployment-wide default threshold: set it in Settings → Autocompact and every model without its own threshold compacts early at that count, while per-model entries and /autocompact still take precedence. Leaving it empty keeps those models on the backend's own compaction.

## 0.1.1

### Patch Changes

- Declare the harness range this plugin is built against, so the plugin market refuses an install on an incompatible dsh rather than installing one that breaks.

## 0.1.0 - 2026-10-16

- Initial dsh port of `@indexyz/pi-autocompact`.
- Add session-only per-model `/autocompact` thresholds with optional read-only global defaults.
- Compact an explicit balanced surface range through `ctx.compaction.compactRegion` at `agent/pre-step`, preserving the backend's retained tail and never aborting the turn.
- Respect a backend whose automatic compaction is disabled and backends without region compaction.
- Add a Settings page that edits the persisted per-model thresholds through the Host settings service, fed by the live model catalog.
- Read the `settings` Remote namespace as its own injected Cordis service (`remote.settings`) and treat the model catalog as optional, so the page renders on every composition; give the section its own crash boundary so a failure is visible instead of an empty page.
- Declare `modelLimits` and `enabled` as `.volatile()` Config fields (and read them through their references), so the Host settings service lists the row and saved edits reach the running plugin without a restart.
- Rewrite the browser half as TypeScript (`src/client/index.tsx`) and build the committed `client.js` with tsdown/oxc, which supplies the module-loader wrapper and keeps React external.
- Split that browser half into focused modules under `src/client/` — contracts, services, state, limits, dictionary, styles, page, two views, crash boundary — with `index.tsx` left as the registration entry.
- Add a composer status entry (`conversation.composer.dock`, beside the session's turn/token/context readings) showing the current model's deployment default, the measured pressure, and the master switch, fed by the `modelSelection`/`contextPressure` projections and shared with the Settings page through one config store. It takes no seat in that row while no threshold applies to the current model.
- Render token counts in the composer status entry and the Settings rows in the `{value}K`/`{value}M` units the composer's own readings use, instead of comma-separated absolute numbers.
- Dress the composer status entry as one of the host's ambient pills: the host's data-outline icon artwork, the stats pill's padding, radius, tertiary colour, density-aware type size and 14px icon size, and no plugin name in the text — the icon identifies the entry and the tooltip explains it.
- Make that status entry a button that opens Settings on this plugin's section, by resolving the settings shell's store seat through the slot registry and invoking the shell's own `openSection` (its handle is pinned to the live instance, so the action reaches the store the panel renders from; a store declared any other way mints an instance the panel never sees, hence the capability check). The central panel this plugin registers under its own key stays as the fallback destination, and both paths are guarded.
