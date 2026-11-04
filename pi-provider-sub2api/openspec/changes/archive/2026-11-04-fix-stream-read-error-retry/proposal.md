# Proposal

## Why

The README promises that a relayed `stream_read_error` is retried by Pi, and c72042e removed the extension's own retry loop on that basis. Pi 1.5.0's classifier only matches `upstream_stream_read_error`, so all three wire shapes end the turn after one attempt with no `auto_retry_start`. This is the production failure 56177b3 fixed before that removal. The README also still describes retries for discovery and billing that c72042e removed, and a three-minute compaction timeout that 796eeb2 raised to five minutes.

## What Changes

- The Codex stream handler reports a relayed `stream_read_error` to Pi as `upstream_stream_read_error`, so Pi's own retry handling restarts the turn. Other errors, including context overflow, reach Pi unchanged.
- README: correct the retry and timeout statements.

## Capabilities

### New Capabilities

- `relay-stream-errors`: how relayed Codex stream failures reach Pi's retry and overflow handling.

### Modified Capabilities

None.

## Impact

`pi-provider-sub2api/relay-stream.ts` and `README.md`. `@indexyz/pi-provider-sub2api` gets a `patch` release intent. The regression scenarios land in `scripts/e2e/pi/pi-provider-sub2api-retry.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
