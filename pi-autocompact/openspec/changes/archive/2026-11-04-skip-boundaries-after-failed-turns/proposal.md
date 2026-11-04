# Proposal

## Why

`checkBoundary` ignores `event.outcome`, so a turn that failed or was aborted while over the threshold immediately sends a paid summary request, and appends a compaction after the error turn. While a provider is down, that is one more request to a provider already failing. Pi's own example filters on `outcome`.

## What Changes

- Boundary compaction runs only for a completed turn. The attempt is not consumed, so the next successful turn compacts. Pi's own overflow recovery is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autocompact-thresholds`: boundary compaction skips failed and aborted turns.

## Impact

`pi-autocompact/index.ts`. `@indexyz/pi-autocompact` gets a `patch` release intent. The scenario lands in `scripts/e2e/pi/pi-autocompact.e2e.ts`.
