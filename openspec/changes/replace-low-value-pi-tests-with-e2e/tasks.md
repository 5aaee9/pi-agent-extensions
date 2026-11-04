# Tasks

Each package group follows the order in `design.md` D6: defect fixes with their failing scenarios, then remaining scenarios, then REPLACE deletions, then DELETE deletions. Verdicts per test are in `audit/`; where the design's Cleanup table differs, the design wins. Every scenario's mutation proof goes in `verification.md` (D7). A fix's OpenSpec change lives in that package's own root, lists its scenario edit in its own tasks, carries a `patch` intent, and lands the scenario in the same commit as the fix. Doc tasks target whichever layout `isolate-plugin-systems-in-agent-docs` has left: if it landed first, "Upgrade Pi" and the Pi guidance live under `docs/pi/`, and `--kind pi` and `test:e2e:pi` belong in those files and the package `openspec/config.yaml` contexts too.

## 1. Harness and installed-shape loading

- [x] 1.1 Add `node-pty` at the exact version `pi-ask` pins to the root `devDependencies`, run `npm install`, and correct the "root `devDependencies` hold only repository tooling" bullet in `docs/conventions.md`; verify only the root manifest, lockfile, and that bullet change, and `npm run lint:tooling` and `tsc -p tsconfig.json` still pass.
- [x] 1.2 Add `scripts/e2e/pi/` harness modules `world`, `pi`, `servers`, and `pty` per D2 to the strict tooling profile; verify a throwaway scenario installs `@indexyz/pi-skill` through `pi install` with `npm_config_offline=true`, runs one RPC prompt against a local server, leaves no process or temporary directory behind, writes nothing under the real `~/.npm` or `~/.pi`, and that `world` refuses a temporary root under a `node_modules` tree.
- [x] 1.3 Replace `checkPi` in `scripts/e2e/plugins.ts` with pack, `pi install`, and load, remove the checkout path, and add a `--kind pi` filter; verify `npm run test:e2e` passes for all eight Pi packages with DSH output unchanged, `npm run test:e2e -- --kind pi` builds no `dsh-*` package, and removing a statically imported module from a scratch copy's `files` fails the check.
- [x] 1.4 Add the root `test:e2e:pi` script and a quality workflow step after `test:e2e`; verify the script runs without building any `dsh-*` package and a deliberately failing scenario fails it with the command and output reported.
- [x] 1.5 Update `docs/workflow.md` ("Verify", "Remove an extension"), `docs/architecture.md`, and the `AGENTS.md` command table; verify each documented command runs as written.

## 2. Cross-package scenarios

- [ ] 2.1 Add the per-package registrations table and X2 in `cross-package.e2e.ts`, with `pi-skill`'s entry naming an effect at the local server rather than a command; verify each package's expectations hold with a local-server config, an unlisted Pi package fails the run by name, and mutations that stop `pi-custom-provider` registering or stop `pi-skill` loading each fail it.
- [ ] 2.2 Add X3 with all eight packages co-installed (print, JSON, RPC prompt, `set_model`, `new_session`, fork); verify no `extension_error` and bounded exits, and that a mutation adding an uncleared timer to a scratch package fails the print-exit assertion.

## 3. `pi-continue`

- [ ] 3.1 Propose and apply a package change fixing defect 1 with N1 failing first; verify `-p` and `--mode json` each make one model request and exit 0, and record a `patch` intent.
- [ ] 3.2 Add N2 and N3; verify the retried turn resumes from the tool result, that N3 issues no model request until the in-flight compaction ends, and that a second `/continue` after a failed retry succeeds. Check any N3 failure against upstream #10704 first; record a new defect in the register rather than landing a red scenario.
- [ ] 3.3 Point `test/pi-rpc.ts` at `bin.pi` and keep the seven real-process cases on it, moving the context-history case's assertion to the request at the local server; verify all seven pass on the bin, and that regressing 173d51d and 05143b3 in a scratch copy fails them.
- [ ] 3.4 Delete the audit's DELETE cases including `test/extension-load.test.ts`, and the marker case now covered by N3; verify `npm run check --workspace @indexyz/pi-continue` passes and `git diff` touches no published file beyond the fix.

## 4. `pi-skill`

- [ ] 4.1 Propose and apply a package change fixing defect 2 with K1's parity assertion failing first, replacing `expands a leading $skill token`; verify `$known` and `/skill:known` produce identical blocks on the wire, and record a `patch` intent.
- [ ] 4.2 Add the rest of K1 over RPC `steer` and `follow_up` asserting delivery mode only, and K2 in a real terminal; verify the popup lists the skill and the block renders as `[skill]`, and that scratch mutations dropping the delivery mode or removing `triggerCharacters` each fail.
- [ ] 4.3 Delete the audit's REPLACE and DELETE cases including `test/extension-load.test.ts`; verify the package check passes and no published file changes beyond the fix.

## 5. `pi-model-trace`

- [ ] 5.1 Add T1; verify the installed package answers `/model-trace` and its command forms, and that removing `data/unified_bank.json` from a scratch tarball fails it.
- [ ] 5.2 Correct `keeps prose numbers out of the sampled sequence`, move the challenge assertion to the wire in `command.test.ts`, and replace `attributes a synthetic sequence...` with a self-attribution check, then delete the audit's DELETE cases; verify the package check passes and that inverting the scoring in a scratch copy now fails.

## 6. `pi-autocompact`

- [ ] 6.1 Propose and apply a package change fixing defect 3 with A1's options assertion failing first, confirming the inferred cause; verify the boundary summary request carries `reasoning_effort` and `max_completion_tokens` matching a native compaction, and record a `patch` intent.
- [ ] 6.2 Add the rest of A1 (RPC boundary, tool-group retention) and A2; verify a compaction entry persists in both, no orphan tool result reaches the model, and that reverting 740a8a5's `entries` merge in a scratch copy fails A1.
- [ ] 6.3 Compare the effective compaction settings with the real `SettingsManager` and delete the audit's DELETE cases; verify the package check passes.

## 7. `pi-idle-compression`

- [ ] 7.1 Add I1 and I2 co-installed with `pi-autocompact`; verify exactly one summary per compaction and a bounded print exit with the timer armed, and that removing the guards at `index.ts:59-61` in a scratch copy fails I1.
- [ ] 7.2 Delete the audit's REPLACE and DELETE cases; verify the package check passes and no published file changes.

## 8. `pi-custom-provider`

- [ ] 8.1 Propose and apply a package change fixing defect 5 with C3 failing first, and add the D5 drift test importing `@earendil-works/pi-ai/api/*` from the package; verify no thinking reaches the second model, a deliberate divergence in the vendored copy fails the drift test naming the fixture, and a resolved `pi-ai` version unequal to the pin fails naming both. Record a `patch` intent.
- [ ] 8.2 Propose and apply a package change fixing defect 4 for this package with C4 failing first; verify no request reaches the server, and none is attempted to `models.dev`, under `--offline` or `PI_OFFLINE=1` on cold start, and that the refresh success path publishes new models. Record a `patch` intent.
- [ ] 8.3 Add C1 and C2 with `"modelsDev": false` in their configuration; verify all 12 API and key combinations round trip with the affinity header, `compat`, and `{off:null}` default on the wire, Ollama carries tools and system prompts, a second extension's hooks take effect, and that restoring the top-level `tools` read in a scratch copy fails C2.
- [ ] 8.4 Point `test/pi-host.ts` at `bin.pi`, keeping `does not make an unauthenticated discovery request` on it, correct `awaits raw stream observers`, and delete the affinity-header case and the audit's DELETE cases; verify the package check passes and that removing the observer `await` in a scratch copy now fails.

## 9. `pi-ask`

- [ ] 9.1 Propose and apply a package change fixing defect 6 with Q6 failing first; verify `/answer` works with chat-model-only credentials, a scoped model list, and a keyless provider, and record a `patch` intent.
- [ ] 9.2 Add Q1, Q2, Q4, Q5, Q7, and Q10; verify a real answer reaches the model, `@` suggestions appear, settings persist, a remote answer arrives over real `pi.events`, RPC commands refuse without a model request, and the bundled skill loads after `pi install`.
- [ ] 9.3 Add Q3, Q8, and Q9; verify resume after SIGKILL reopens and submits, cancel does not reopen a third time, the dismiss guard protects typed answers, and 12, 20, and 30 column runs with CJK and emoji keep the process alive.
- [ ] 9.4 Delete the 23 REPLACE cases and 52 DELETE cases, including the six emptied files, leaving the five tracker cases, the legacy PTY cases, and `pi-coding-agent-legacy` untouched; verify the package check passes and no published file changes beyond the fix.

## 10. `pi-provider-sub2api`

- [ ] 10.1 Propose and apply a package change fixing defect 7 with P4 failing first, normalizing `stream_read_error` so Pi retries it; verify all three wire shapes reach a second attempt, overflow recovery still works, and correct the stale README lines. Record a `patch` intent.
- [ ] 10.2 Propose and apply a package change fixing defect 8 with P5 failing first; verify an API switch sends only the current token through the right handler, and a removed provider is unlisted and receives nothing. Record a `patch` intent.
- [ ] 10.3 Propose and apply a package change fixing defect 4 for this package with P7's offline assertion failing first; verify no discovery, billing, or usage request reaches the relay under `--offline` or `PI_OFFLINE=1`, including across one prompt from a seeded cache, whose model request still goes through. Record a `patch` intent.
- [ ] 10.4 Add P1, P2, and P3; verify routing and auth per API, `/openai-compress` plus checkpoint replay in the installed shape, and that renaming a private pi-ai file in a scratch host copy fails P2 rather than passing silently.
- [ ] 10.5 Add P6, the rest of P7, and P8; verify request modes reach the wire and survive save and restart, a second process reuses the discovery cache, and offline, on a seeded cache with placeholder `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, metadata matches `models-store.json` and the built-in model reported by RPC `get_available_models`, with no pinned prices.
- [ ] 10.6 Add P9 and P10; verify the xAI turn and replay, and the footer through a real terminal.
- [ ] 10.7 Delete the 155 REPLACE cases and 40 DELETE cases, including nine emptied files and `test/chat-models.ts`; swap the 25 KEEP cases that build a fake `pi` for direct `loadRelayConfigs` calls; verify the package check passes and no test in the package references `as unknown as ExtensionAPI` or stubs `fetch`.

## 11. Testing policy

- [ ] 11.1 Update `docs/conventions.md` "Tests" and `docs/workflow.md` to state the Pi exceptions (pure logic, real host utilities, vendored comparison), the assertion requirement, that Pi stand-in conversions may land in the root suite, and that the `pi-provider-sub2api` conversion is complete with live endpoints still untested; verify no remaining text calls it deferred and DSH guidance is unchanged in meaning.
- [ ] 11.2 Update the `pi-extension-dev` skill's test and verify steps to point at `test:e2e:pi`; verify `CLAUDE.md` is still exactly `@AGENTS.md`.

## 12. Upgrade rehearsal

- [ ] 12.1 Add the pin script and `.github/workflows/pi-host-rehearsal.yml` per D4 with `contents: read` and no secrets; verify locally that the script changes only Pi workspace `@earendil-works/*` pins, leaving `pi-ask`'s legacy alias and every `dsh-*` manifest untouched.
- [ ] 12.2 Prove detection by rehearsing Pi 1.4.0 through the same script in a throwaway checkout; verify at least `pi-model-trace` fails typecheck on `pi.exec`'s `maxBuffer` (added in 1.5.0; the other two `maxBuffer` uses are Node's `exec`), record which other packages and scenarios fail and why, the run reports the version it tested, failures are recorded in `verification.md`, and the real checkout's working tree is unchanged. A run where nothing fails disproves the mechanism.
- [ ] 12.3 Document the rehearsal, its `pi-version` input, and how to read a failure in `docs/workflow.md` "Upgrade Pi"; verify the documented dispatch command is valid against the workflow file.

## 13. Final verification

- [ ] 13.1 From a clean `npm ci`, run root `npm run check`, `npm run test:e2e`, and `npm run test:e2e:pi`, which this shared-tooling change needs regardless of `isolate-plugin-systems-in-agent-docs`; verify all pass, then record suite runtime and repeat `test:e2e:pi` three times to expose flakiness.
- [ ] 13.2 Run the load smoke test from `docs/workflow.md` for each of the eight Pi packages; verify exit 0 and a successful `get_commands` response, and that it lists the commands each package registers unconfigured: `pi-provider-sub2api`, `pi-custom-provider`, and `pi-skill` legitimately list none.
- [ ] 13.3 Verify scope: `git diff` touches no `dsh-*` path and no DSH requirement, `npm run test:e2e` DSH results are unchanged, and `npm run release:gate -- --base origin/main --head HEAD` passes with a release decision for every package whose published content changed.
- [ ] 13.4 Confirm every catalog scenario appears in `verification.md` with its observed failure and every audit REPLACE row is covered by a named scenario, kept on a corrected form in the Cleanup table, or listed as an explicit exclusion in `design.md`.

## Workflow follow-up

- Run the multi-model review of the implementation once it is complete.
- Archive this change and each package-scoped fix change once review is satisfied. Preparing versions and publishing stay separate explicit requests.
