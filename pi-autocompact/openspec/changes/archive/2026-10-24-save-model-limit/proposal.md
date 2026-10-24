# Proposal

## Why

`/autocompact 300k` sets a threshold only for the current session. The same model in a later session falls back to Pi's own compaction unless the user hand-edits `piAutocompact.modelLimits` in user settings. A `--save` flag should write that existing default for the current model so the next session picks it up.

## What Changes

- Accept an optional `--save` flag when `/autocompact` sets a numeric threshold (`300k`, `0.3m`, `300000`).
- With `--save`, keep today's session override and also merge the integer token count into user settings at `piAutocompact.modelLimits["provider/modelId"]`. Leave every other settings key unchanged.
- Without `--save`, do not write settings.
- Reject `--save` with `off`, `default`, a bare status query, a repeated flag, or any other non-threshold argument. Those invocations change neither the session nor the file.
- A later session for that model inherits the saved value through the existing `session_start` read of user settings. The session that saved does not need `/reload`, because the command still applies the session override.
- A failed save (malformed JSON, a non-object `piAutocompact` / `modelLimits`, or a lock that cannot be acquired) reports the error and leaves the session override and the file as they were.

## Capabilities

### New Capabilities

- `autocompact-thresholds`: Session and saved per-model compaction thresholds for `/autocompact`, including when the command writes user settings and how a later session inherits them.

### Modified Capabilities

None. This package has no specs yet.

## Impact

- `pi-autocompact` command parsing and the `/autocompact` handler (`index.ts`, `settings.ts`).
- User `settings.json` (normally `~/.pi/agent/settings.json`, respecting `PI_CODING_AGENT_DIR`). No new settings file. Project `.pi/settings.json` is not written.
- Tests, package README, changelog, and a minor release intent for `@indexyz/pi-autocompact`.
- No new dependency. Pi 0.87.1 exposes no extension API for writing an unknown settings key, so the write targets the same user settings file this package already reads, under the same `settings.json.lock` directory Pi's settings manager uses.
