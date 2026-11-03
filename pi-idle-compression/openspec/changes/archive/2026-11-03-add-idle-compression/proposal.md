# Proposal

## Why

A session left open after the agent finishes keeps its whole context. When the user comes back much later, the provider's prompt cache has usually expired, so the next prompt pays to re-read the full, uncompacted transcript. Compacting while the session is idle makes that next prompt smaller and cheaper without the user having to remember `/compact`.

## What Changes

- New package `@indexyz/pi-idle-compression` (`pi-idle-compression/`).
- When Pi settles (no retry, compaction, or queued follow-up left) and no new user input arrives for the configured idle time (default 50 minutes), run Pi's native compaction (`ctx.compact()`) once.
- Configure it in user `settings.json` under `piIdleCompression`: top-level `enabled` / `idleMinutes`, overridden per provider (`providers.<provider>`) and per model (`models["provider/modelId"]`).
- `/idle-compression` reports the effective settings for the current model and the time left before idle compaction.

## Capabilities

### New Capabilities

- `idle-compression`: Idle detection, the compaction it triggers, and the layered settings that control it.

### Modified Capabilities

None.

## Impact

- New workspace package and root `workspaces` / `pi.extensions` entries, root README row.
- Reads user `settings.json` (`~/.pi/agent/settings.json`, respecting `PI_CODING_AGENT_DIR`); never writes it.
- Compaction calls the model and consumes tokens, like `/compact`.
- Minor release intent for the first release.
