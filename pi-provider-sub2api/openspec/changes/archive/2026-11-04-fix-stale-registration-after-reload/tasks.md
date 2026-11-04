# Tasks

## 1. Fix

- [x] 1.1 Add the reload matrix and the refresh case to `scripts/e2e/pi/pi-provider-sub2api-reload.e2e.ts` and observe the rotated-out token and the stale Codex handler before the fix.
- [x] 1.2 Unregister on `session_shutdown` and before a registration without a Codex model; verify the API switch sends only the current token through the right handler, a removed relay is unlisted and receives nothing, and `/new` keeps the relay model working.
- [x] 1.3 Keep the aborted in-flight usage request in the same scenario file.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-provider-sub2api`.
