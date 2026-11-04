# Tasks

## 1. Fix

- [x] 1.1 Add scenario "/continue in print and JSON modes retries the failed turn and exits 0" to `scripts/e2e/pi/pi-continue.e2e.ts` and observe it fail before the fix.
- [x] 1.2 Await `ctx.waitForIdle()` after `pi.sendMessage` in the command handler; verify the scenario passes.
- [x] 1.3 Record a `patch` intent for `@indexyz/pi-continue`; verify `npm run release:gate` accepts it.
