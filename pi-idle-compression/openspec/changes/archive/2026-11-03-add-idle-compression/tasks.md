# Tasks

## 1. Package

- [x] 1.1 Scaffold `pi-idle-compression/` from the workspace templates, add it to root `workspaces` and `pi.extensions`, and run `npm install`.

## 2. Settings

- [x] 2.1 Resolve `enabled` and `idleMinutes` from model, provider, top level, and defaults, validating each value. Verify with unit tests for precedence and every invalid form.

## 3. Idle timer

- [x] 3.1 Arm on `agent_settled` and on `session_start` with an assistant reply; cancel on `input`, `agent_start`, `session_compact`, and `session_shutdown`; re-arm on `model_select` keeping the idle start. Verify through Pi's real loader and agent loop against a local model server.
- [x] 3.2 On expiry re-check idle, pending messages, last entry, and measured usage, then call `ctx.compact()` with notifications. Verify compaction happens once, not after new input, not after `/compact`, and a failure is reported.
- [x] 3.3 Register `/idle-compression` status. Verify it reports settings and remaining time.

## 4. Docs, release, verification

- [x] 4.1 Write the package README and the root README row.
- [x] 4.2 Record a minor release intent for `@indexyz/pi-idle-compression`.
- [x] 4.3 Run `npm run check`, the RPC load smoke, and `openspec validate add-idle-compression --strict`.
