# Tasks

## 1. Fix

- [x] 1.1 Add scenarios "a cold start under PI_OFFLINE=1 ..." and "a cold start under --offline ..." to `scripts/e2e/pi/pi-custom-provider.e2e.ts`, with models.dev enabled and pointing at the local server, and observe them fail before the fix.
- [x] 1.2 Gate the startup provider fetch, the startup models.dev fetch, and the `session_start` refresh on the mode, leaving `/refresh-custom-provider-models` unchanged; verify both scenarios and "offline, expired caches stay registered and nothing refreshes them" pass.
- [x] 1.3 Add scenario "/refresh-custom-provider-models publishes the models upstream now lists" and verify removing the re-registration fails it.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-custom-provider`.
