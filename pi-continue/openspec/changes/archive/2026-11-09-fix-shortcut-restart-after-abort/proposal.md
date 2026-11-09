# Proposal

## Why

A shortcut pressed during a running turn waits for that turn to end, and the wait outlives the
press. If the user then interrupts the turn, the wait finds an aborted turn and retries it, so
Esc restarts the work the user just stopped.

## What Changes

- A shortcut pressed while the agent is busy reports that and starts nothing, leaving no wait behind.
- A shortcut pressed while an abort is settling still waits for it and retries.
- `/continue` is unchanged: it still waits for idle, including an in-flight compaction.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continue-command`: a shortcut retries only a turn that has stopped or is being aborted.

## Impact

`pi-continue/index.ts`, its README, and the terminal scenarios in
`scripts/e2e/pi/pi-continue-shortcuts.e2e.ts`, split from `pi-continue.e2e.ts` at the file length limit.
`@indexyz/pi-continue` gets a `patch` release intent.
