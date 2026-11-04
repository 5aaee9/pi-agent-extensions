# Verification: pi-custom-provider

Scenario files: `scripts/e2e/pi/pi-custom-provider.e2e.ts` (C4), `pi-custom-provider-native.e2e.ts` (C1), `pi-custom-provider-ollama.e2e.ts` (C2, C3); protocol replies in `servers-custom-provider.ts`. Twelve scenarios, about 5 seconds per run; five consecutive runs passed 12/12.

## Before the fixes

| Scenario                                                                    | State   | Observed                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3 `thinking from one Ollama model does not reach the next model's request` | unfixed | Failed: assistant `content` was `'PRIVATE-THINKING-MARKER\nvisible answer'`                                                                                 |
| C4 `a cold start under PI_OFFLINE=1 ...`                                    | unfixed | Failed: `get_available_models` listed `gateway/discovered`, so discovery ran                                                                                |
| C4 `a cold start under --offline ...`                                       | unfixed | Failed: same                                                                                                                                                |
| D5 drift test                                                               | unfixed | 14 of 28 cases failed: `transformMessages` on 3 cross-model fixtures, `estimateContextTokens` on 3, `buildBaseOptions` on 5, `clampMaxTokensToContext` on 3 |

## Mutation proofs

| Scenario                      | Regression applied                                                               | Observed                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C3                            | Cross-model thinking converted back to text                                      | Failed: `the visible history survives`                                   |
| C3                            | All thinking dropped, same model included                                        | Failed: `the same model replays its own thinking`                        |
| C4 cold start, both forms     | Startup provider fetch not gated                                                 | Both failed                                                              |
| C4 cold start, `PI_OFFLINE=1` | Startup models.dev fetch not gated (the case `"modelsDev": false` could not see) | Failed: `no discovery and no models.dev request`; `--offline` failed too |
| C4 cold start, both forms     | Offline start registers no fallback models                                       | Both failed                                                              |
| C4 expired caches             | `session_start` refresh not gated                                                | Failed: `the turn a user asked for is the only request`                  |
| C4 refresh                    | `register(provider)` removed from the command                                    | Failed: only `gateway/before` listed                                     |
| C4 refresh                    | Command does not force the fetch                                                 | Failed: only `gateway/before` listed                                     |
| C1                            | Affinity assignment removed                                                      | Failed: `openai-completions-command affinity`                            |
| C1                            | Affinity header sent for every provider                                          | Failed: `only the configured provider sends it`                          |
| C1                            | Provider `compat` dropped                                                        | Failed: `openai-completions-command compat missing`                      |
| C1                            | `{off:null}` default returns `undefined`                                         | Failed: `openai-responses-command invented a disabled effort`            |
| C1                            | `apiKey` not registered (d23cade)                                                | Failed: `openai-completions-command`, model not listed                   |
| C1                            | Key always escaped as a literal                                                  | Failed: auth on `openai-completions-command` chat request                |
| C1                            | `authHeader: true` dropped                                                       | Failed: auth on `anthropic-messages-header` chat request                 |
| C1                            | `!command` Authorization wrapper removed                                         | **Not detected**: equivalent, see Findings                               |
| C2 tools                      | Top-level `tools` read restored                                                  | Failed: `the request must carry tools`                                   |
| C2 tools                      | System message not sent                                                          | Failed: request had only the user message                                |
| C2 tools, hooks               | `options.headers` ignored                                                        | Both failed                                                              |
| C2 hooks                      | `onPayload` not called                                                           | Failed: no `seed` in the request                                         |
| C2 hooks                      | `onResponse` not called                                                          | Failed: no notification                                                  |
| C2 500/429                    | Status not checked                                                               | Failed                                                                   |
| C2 500/429                    | Daemon's error text replaced by the status text                                  | Failed                                                                   |
| C2 429 retry                  | `maxRetries` ignored                                                             | Failed                                                                   |
| C2 429 retry                  | Every status retried                                                             | Failed once the scenario used `maxRetries: 2`; see Findings              |
| C2 missing `done`             | `done` not required                                                              | Failed                                                                   |
| C2 abort                      | Signal not passed to `fetch`                                                     | Failed: `timed out waiting for the abort` after 30 s                     |
| C2 abort                      | Abort reported as error                                                          | Failed: `stopReason` was `error`                                         |

## Package tests

| Test                                                                                         | Regression applied                                             | Observed                                                                                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D5 `transformMessages: cross-model thinking and text`                                        | Divergence in the vendored thinking branch                     | 3 failed, each naming its fixture, for example `transformMessages: thinking from another provider`                       |
| D5 estimator cases                                                                           | `CHARS_PER_TOKEN` back to 4                                    | 7 failed, each naming its fixture                                                                                        |
| D5 `buildBaseOptions` cases                                                                  | `timeoutMs` dropped from the list                              | 5 failed, each naming its fixture                                                                                        |
| D5 `resolves the pi-ai version this package pins`                                            | Pin edited to 1.4.0                                            | Failed: `resolved 1.5.0 at .../pi-custom-provider/node_modules/@earendil-works/pi-ai/package.json, but the pin is 1.4.0` |
| `awaits raw stream observers` (corrected)                                                    | Observer `await` replaced by `void`                            | Failed                                                                                                                   |
| `does not make an unauthenticated discovery request` (on `bin.pi`)                           | Failed credential command swallowed, so discovery sends no key | Failed                                                                                                                   |
| `applies reasoningPattern...`, surviving detector for the deleted `reads Anthropic-style...` | `max_input_tokens` no longer read                              | Failed                                                                                                                   |
| `preserves literal escapes...`, surviving detector for the deleted `trims stdout...`         | Command stdout not trimmed                                     | Failed                                                                                                                   |

## Findings

- **Divergences beyond defect 5, aligned.** The drift test exposed that the vendored estimator used 4 characters per token where 1.5.0 uses 3.5, which changes `num_predict` on the wire, and that `buildBaseOptions` spread every caller option where 1.5.0 forwards a list and leaves `samplingParams` unset. Both now match the host; `ollama.ts` reads nothing outside that list. The estimator comparison imports `@earendil-works/pi-ai/utils/estimate`, beside the `api/*` subpaths D5 names, because that is where it lives.
- **Equivalent mutation, recorded.** Removing the `!printf 'Bearer %s'` wrapper in `discovery.ts` for `authHeader` plus `!command` leaves C1 passing: Pi 1.5.0 resolves the key before applying `authHeader` (`provider-composer.js:216`, `withConfiguredAuth`: "authHeader requires a resolved API key"), so the wire carries `Bearer cmd-key` either way. The wrapper and its comment look obsolete on 1.5.0. Left in place: it is not part of this task's defects.
- **Mutations that first missed, for a reason each.** Mutating `options?.signal ?? null` for abort passed because that branch is unused: `timeoutMs` is set by default, so the `AbortSignal.any` branch runs. Removing `signal` from `fetch` is the real regression and is detected. `retriable = true` passed with `maxRetries: 1` because the retry budget ran out on the 200; the scenario now uses `maxRetries: 2`.
- **`{off:null}` on the wire, for the owner to judge.** For a reasoning model with no level list, `--thinking off` is clamped up by Pi: observed `thinkingLevel: "minimal"`, `reasoning_effort: "minimal"` on completions, `reasoning.effort: "minimal"` on Responses, and an enabled 1024-token budget on Anthropic. This matches the code comment's intent (no invented `none`), and C1 asserts only that no disabled value is sent, not Pi's clamp. A user asking for off still gets minimal thinking.
- **Offline read.** `ExtensionAPI` exposes no offline state: `getFlag` is for an extension's own flags and `allowNetwork` exists only inside `refreshModels`. `main.js:455-458` sets `PI_OFFLINE=1` for `--offline` and truthy values before extensions load, so the package reads the variable with Pi's truthy values. Pi's `ModelRuntime` separately treats any defined value, `PI_OFFLINE=0` included, as network off; the package follows `main`.
- **Not asserted either way.** `/refresh-custom-provider-models` under offline makes requests by design, since a user asked; no scenario pins that.
- **Audit notes left as they are.** `provider.test.ts` still pins "Custom provider models refreshed" on a refresh that used fallback models. The vacuous lines the audit names inside two KEEP cases (`enriches models...`, `refreshes expired caches...`) stay, since the Cleanup table does not list them.

## Deviations

- `awaits raw stream observers`: the audit says to assert the whole order array, but the real order is `observing-1, observed-1, observing-2, delta, observed-2, done`, where `observing-2` before `delta` is stream scheduling and not the contract. The corrected test asserts every step ran, which removes the `-1` vacuity, then the spec's orderings. It fails with the `await` removed.
- C4 runs `PI_OFFLINE=1` and `--offline` in separate scenarios rather than both together as D2 says, so each form is proven alone. C4 keeps `modelsDev` enabled with local URLs, per the addendum to task 8.2.
- C1 runs all 12 combinations in one world and one process, routed by path prefix, and adds a thirteenth provider without the affinity setting to keep the deleted case's negative assertion.
- Added `offline, expired caches stay registered and nothing refreshes them`, since the register's fix covers background discovery and C4's cold start does not reach it.

## Case counts

Audit verdicts held: 29 cases, DELETE 2 (`reads Anthropic-style...`, `trims stdout...`), to E2E 1 (affinity header, to C1), stays 26. No test file removed. The drift test adds 28 cases, so `npm run check --workspace @indexyz/pi-custom-provider` runs 54.
