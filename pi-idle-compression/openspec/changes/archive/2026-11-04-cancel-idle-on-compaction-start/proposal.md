# Proposal

## Why

An idle timer currently survives a manual compaction that fails or is cancelled because only successful compaction cancels it. The Pi 1.5.0 audit reproduced a second paid summarization attempt when the old timer expired after a manual failure.

## What Changes

- End the idle period when native compaction starts, including attempts that fail or are cancelled.
- Verify failed and cancelled attempts through Pi's real host and local model transport.
- Explain how the existing idle-compaction policy interacts with Pi's optional idle cache warming, without adding a new policy or setting.
- Record a patch release intent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `idle-compression`: any native compaction attempt ends the current idle period.

## Impact

Changes lifecycle handlers, real-host tests, and the README. The repository-wide Pi 1.5.0 upgrade supplies the host pin; no new runtime dependency or configuration is needed.
