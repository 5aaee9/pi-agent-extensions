# Proposal

## Why

Under `--offline` or `PI_OFFLINE=1` the extension still sends `GET /v1/models` on a cold start and fetches models.dev, and refreshes expired caches after `session_start`. Pi documents the mode as disabling automatic network activity, including model catalog refreshes (`docs/environment-variables.md`, `docs/cli.md`).

## What Changes

- Read the mode at load. Pi's extension API has no offline accessor: `pi.getFlag` covers only an extension's own flags, and `refreshModels` learns `allowNetwork` per call, which reaches neither the startup fetch in the factory nor the `session_start` refresh. `main()` sets `PI_OFFLINE=1` for `--offline` and for every truthy value before loading extensions, so reading the variable, with the same truthy values Pi accepts, covers both forms.
- Offline, an uncached provider registers its `fallbackModels` instead of fetching, an uncached models.dev catalog stays empty, and expired caches stay registered without a background refresh.
- `/refresh-custom-provider-models` is unchanged: a user asked for it, and the mode covers automatic activity only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `startup-discovery`: adds what startup and background refresh do offline.

## Impact

`pi-custom-provider/index.ts`, `pi-custom-provider/README.md`. `@indexyz/pi-custom-provider` gets a `patch` release intent. The regression scenarios land in `scripts/e2e/pi/pi-custom-provider.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
