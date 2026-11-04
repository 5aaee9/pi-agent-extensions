# Tasks

## 1. Fix

- [x] 1.1 Add scenario "a boundary summary carries the reasoning effort and output limit of a native one" to `scripts/e2e/pi/pi-autocompact.e2e.ts` and observe it fail before the fix.
- [x] 1.2 Stream boundary summaries through `ctx.modelRegistry.streamSimple`; verify the scenario passes and that restoring `stream` fails it.
- [x] 1.3 Record a `patch` intent for `@indexyz/pi-autocompact`; verify `npm run change:status` lists it.
