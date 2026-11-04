# Proposal

## Why

Pi documents `--offline` and `PI_OFFLINE=1` as disabling automatic network activity. The extension has no reference to either: under both it still sends Codex discovery on a stale cache or cold start, billing, and a usage request at session start, on model selection, and after each turn.

## What Changes

- Under `--offline` or `PI_OFFLINE=1`, the extension sends no automatic discovery, billing, or usage request. It reads `PI_OFFLINE`, which Pi sets for both forms before it loads extensions; the extension API has no accessor for it.
- Cached models stay available and a stale cache is used as it is. Without a cache a relay registers no models. No usage row is shown.
- `/sub2api-refresh` and model requests are the user's own and still reach the relay.

## Capabilities

### New Capabilities

- `offline-mode`: which relay requests the extension sends under Pi's offline mode.

### Modified Capabilities

None.

## Impact

`pi-provider-sub2api/index.ts`, `util.ts`, and `README.md`. `@indexyz/pi-provider-sub2api` gets a `patch` release intent. The regression scenarios land in `scripts/e2e/pi/pi-provider-sub2api-cache.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
