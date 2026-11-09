# Proposal

## Why

`/continue` and its shortcuts are one action but waited differently. `/continue` submitted during
a running turn still waited behind it, so interrupting that turn restarted it; a shortcut refused,
but also refused during a compaction, where `/continue` waited.

## What Changes

- `/continue` and the shortcuts share one path, including how they wait and what they report.
- During a running turn, neither starts anything nor leaves anything waiting.
- While an abort or a compaction is finishing, both wait and then retry.
- Only the command validates arguments and holds print and JSON runs open until the retry ends.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continue-command`: the rule for a busy session applies to `/continue` as well as the shortcuts.

## Impact

`pi-continue/index.ts`, its README, and `scripts/e2e/pi/pi-continue-shortcuts.e2e.ts`.
`@indexyz/pi-continue` keeps its pending `patch` intent, with the summary widened to the command.
