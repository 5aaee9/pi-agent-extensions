# Tasks

## 1. Fix

- [x] 1.1 Add scenario "thinking from one Ollama model does not reach the next model's request" to `scripts/e2e/pi/pi-custom-provider-ollama.e2e.ts` and observe it fail before the fix.
- [x] 1.2 Add `test/vendored-drift.test.ts`; observe it fail on the thinking branch, the estimator ratio, and `buildBaseOptions`.
- [x] 1.3 Align `pi-ai-internal.ts` with pinned pi-ai 1.5.0; verify the scenario and the drift test pass, a deliberate divergence fails naming the fixture, and a pin unequal to the resolved version fails naming both.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-custom-provider`.
