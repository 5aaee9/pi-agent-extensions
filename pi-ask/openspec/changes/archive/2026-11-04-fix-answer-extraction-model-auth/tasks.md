# Tasks

## 1. Fix

- [x] 1.1 Add the `/answer` scenarios to `scripts/e2e/pi/pi-ask-answer.e2e.ts` and observe them fail before the fix with `Provider is not configured`.
- [x] 1.2 Require `hasConfiguredAuth` and resolved credentials for the configured models and the chat model fallback; verify `/answer` with chat-model-only credentials, a `--models` scope, and keyless providers.
- [x] 1.3 Name `@indexyz/pi-ask` in the `/ask-settings` header and `docs/configuration.md`, and correct the tests that pin the old name; leave the event channels and attribution alone.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-ask`; verify `npm run release:gate` accepts it once committed. The intent is recorded and listed by `npm run change:status`.
