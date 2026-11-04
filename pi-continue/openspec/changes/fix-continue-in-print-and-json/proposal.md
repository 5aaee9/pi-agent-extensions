# Proposal

## Why

`/continue` does nothing in print and JSON modes: `pi -p /continue` exits 1, re-printing the old error, and `pi --mode json /continue` exits 0 silently, both with no model request. The command calls `pi.sendMessage(..., { triggerTurn: true })` and returns, so the CLI disposes the session before the run starts. Upstream closed the report (earendil-works/pi#11011) as not planned and points extensions at `ctx.waitForIdle()`.

## What Changes

- The command handler waits for the retried run to finish after starting it.

## Capabilities

### New Capabilities

- `continue-command`: how `/continue` retries an interrupted or failed turn across Pi's modes.

### Modified Capabilities

None.

## Impact

`pi-continue/index.ts`. `@indexyz/pi-continue` gets a `patch` release intent. The regression scenario lands in `scripts/e2e/pi/pi-continue.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
