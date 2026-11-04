# Tasks

## 1. Change

- [x] 1.1 Compare requests on four APIs with the failed-turn removal off, and with the whole hook off; verify the first is identical on all four and the second adds an empty user message on `ollama-chat`.
- [x] 1.2 Reduce the hook to removing the marker; verify `npm run check --workspace @indexyz/pi-continue` and `scripts/e2e/pi/pi-continue.e2e.ts` pass.
- [x] 1.3 Add scenario "the retry marker never reaches a provider as an empty message"; verify it fails with the hook disabled.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-continue`.
