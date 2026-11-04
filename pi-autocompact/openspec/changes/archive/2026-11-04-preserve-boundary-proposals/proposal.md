# Proposal

## Why

When autocompact adds a summary at a turn boundary, it replaces entries proposed by earlier extensions. The Pi 1.5.0 audit reproduced a preceding extension's session metadata disappearing whenever compaction ran.

## What Changes

- Preserve preceding boundary entries when appending the autocompact summary.
- Add a regression through Pi's real extension loader and model transport.
- Document extension composition and record a patch release intent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autocompact-thresholds`: boundary compaction preserves earlier extension proposals in order.

## Impact

Changes `index.ts`, the real-host test helper and tests, and the README. The repository-wide Pi 1.5.0 upgrade supplies the host pin; this fix adds no dependencies or configuration.
