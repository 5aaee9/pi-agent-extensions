# Test audit: pi-custom-provider, pi-model-trace, pi-skill

Pinned host: Pi 1.5.0. Repository not edited (`git status` shows only the pre-existing `openspec/changes/isolate-plugin-systems-in-agent-docs/`).

## 1. Conclusion

These three suites are not mostly meaningless. Of 69 cases, 12 should be deleted, 10 replaced, and 47 kept. In mutation runs, the KEEP tests were usually the only detector of the bug they target.

The real problem is what the suites do not reach:

- Almost nothing runs configured extensions through the real `pi` bin. `pi-model-trace` is the exception and is the model to copy.
- Three live defects and one questionable behaviour exist today, all invisible to a green `npm run check`. Details are in section 2.
- One test locks in a live bug (`expands a leading $skill token`), and two pass without testing what they name (`awaits raw stream observers`, `keeps prose numbers out of the sampled sequence`).

If the owner's claim is true of the repository as a whole, the evidence for it lies in other packages. For these three, deleting is the small part of the job and new real-host scenarios are the large part.

## 2. Defects found (all verified on the real bin unless noted)

The lab drove `node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js` over RPC or a pty against a local HTTP server.

| #   | Package         | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                               | Detected by tests today                                                                                                                                                                        |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | custom-provider | **Cross-model thinking leaks into Ollama's visible history.** Pinned upstream `transformMessages` drops thinking from another model (`pi-ai/dist/api/transform-messages.js`, comment: "makes the new model treat it as part of the visible reply"). The vendored copy converts it to text (`pi-ai-internal.ts:288-293`), though its header says "aligned with 1.5.0".                                                                                                                           | Two Ollama models, `set_model`, second prompt: the request body has assistant content `"LEAKED-THINKING-MARKER\nfirst answer"`.                        | No. Bypassing `transformMessages` entirely (p1) and flipping the branch to upstream's behaviour (v3) both leave 29/29 passing.                                                                 |
| D2  | skill           | **Wrong "References are relative to" path.** `index.ts:48` uses `sourceInfo.baseDir`, which is the agent directory. Pi's own `/skill:known` uses the skill directory (`agent-session.js:1757`). The README says relative references "keep working". `SourceInfo.baseDir` has no doc comment (`source-info.d.ts:9`), and the run shows the discovery root. Pi defines `skill.baseDir` as `dirname(filePath)` (`skills.js:236,260`), so the fix direction is `dirname(filePath)` unconditionally. | Wire comparison: `$known` says `.../agent`, `/skill:known` says `.../agent/skills/known`.                                                              | No, and `expands a leading $skill token` pins the wrong value, because it builds its expected string from the same `skill.baseDir`. Mutating baseDir to the file path (q9) still passes 24/24. |
| D3  | custom-provider | **`PI_OFFLINE` / `--offline` is ignored on cold start.** Docs: "Disable automatic network activity, including model catalog refreshes" (`environment-variables.md:84`).                                                                                                                                                                                                                                                                                                                         | With both set and no cache, the server received `GET /v1/models`. Inferred, not run: background refresh at `index.ts:130` has no offline check either. | No.                                                                                                                                                                                            |
| Q1  | skill           | **Queued `$skill` input gets its own model turn.** A `follow_up` or `steer` containing `$known` produced 3 requests, not 2. The model answers the skill block alone, then the user's text arrives in a later turn. The owner should decide whether this is intended. It conflicts with the README's "before the original prompt".                                                                                                                                                               | RPC `follow_up` and `steer` both end with `[hello, ok, <skill>, ok, "$known now"]`.                                                                    | No. `uses the input's delivery mode` never sends the user's text after the skill message, so it sees 2 requests.                                                                               |

Smaller findings:

- `expandSkillTokens` returns a rebuilt `text` that production never reads. `index.ts:211` destructures only `{ blocks, failed }`. Four tests fail if that field changes (s5), although users cannot observe it.
- `provider.test.ts:214` pins the notification "Custom provider models refreshed" on a path where the refresh failed and fallback models were used.
- `pi-model-trace/README.md:42` says 13 GPT/Claude candidates. The bank has 24 models in 6 families (verified). This breaks AGENTS.md rule 8.
- `pi-skill/README.md:58` says `$$name` gives a literal `$name`. The handler returns `continue` with the original text, so the model receives `$$name` (from reading `index.ts:206-233`; not run).

## 3. Method and evidence labels

**Read:** the testing spec, `docs/conventions.md` "Tests", READMEs, OpenSpec specs, every test file and targeted source, `git log`, and installed Pi 1.5.0 `dist/` and docs.

**Baseline:** package suites run as is: custom-provider 29/29, model-trace 16/16, skill 24/24.

**Mutations (ids like p1, t4, s2):** each applies one edit to a scratch copy of the package, then runs its Vitest suite and lists failures. 103 mutation runs were made, plus a baseline run per package. One (p33d) is a control, and one (q5) was invalid because of a `$$` replacement bug in my runner, so it was re-run correctly as r1. Plans are in `<throwaway-probe>/plan-*.json`.

**Lab:** real bin scenarios in `<throwaway-probe>/lab/`.

**Labels:**

- **[V]** verified: read in the installed source, or observed in a run.
- **[I]** inferred. Every statement about what a future Pi might do is inferred, as is any user effect I did not reproduce.

**Limits:**

- Not run: a standalone Pi binary, a packaged `pi install`, and a live model endpoint.
- Mutations show that a test detects a specific edit, not that it detects everything. "Sole detector" means among the mutations I ran.

## 4. Facts shaping the verdicts

**Entry points [V].**

- The real `pi` bin is `dist/bundle/cli.js`. It sets `isBundledNode`, and the loader then uses `virtualModules` with `tryNative: false` (`loader.js:477`).
- `pi-custom-provider/test/pi-host.ts:23-26` spawns `dist/cli.js`, which takes the alias route (`loader.js:481`). So does in-process `createAgentSession`.
- `pi-model-trace/test/command.test.ts:14` already uses `bin.pi`, the real entry.
- `createAgentSession` is the real SDK, so I did not treat it as a stand-in (category d). Its blind spot is module mapping only.

**`npm run test:e2e` is weaker than it looks [V].**

- It catches a bad import path: the lab's `@earendil-works/pi-ai/api/simple-options` import made `pi` exit 1. That is the e163ab1 class of bug.
- It does not catch a removed export. A named import of a nonexistent name loaded fine under the real bin with value `undefined`, for both pi-ai and pi-coding-agent. So a host removing an export breaks at first use, not at load.
- For custom-provider it runs with no config, and `index.ts:36` returns before registering anything. The lab saw an empty command list. `scripts/e2e/plugins.ts:141` only asserts `success === true`, so it does not check that any command exists.

**Future Pi exposure [V for the manifest, I for the effect].** Every package declares its host peers as `"*"`, and tests only run against the pin. A user on a newer Pi is untested until the pin moves. Nothing in the repository tests against `latest`.

**Spec tension, for the owner to settle.** `real-environment-testing` says every test drives the host. Your audit criteria keep pure-logic tests. These KEEP verdicts call code directly and would not satisfy the spec as written:

- `fingerprint.test.ts`
- `credential-command.test.ts`
- `parseDiscoveredModel`
- the autocomplete hand-calls

Two proposed replacements would also be off-plane: the self-attribution golden test (section 6) and the vendored differential test (section 9). Both discriminate, but neither drives the host.

I applied your criteria and have not resolved the conflict.

## 5. pi-custom-provider

### test/provider.test.ts

| Test                                                                                        | Verdict               | Reason                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| maps reasoning levels and capability fields without guessing from model names               | KEEP                  | Sole detector of guessing reasoning from a `gpt` prefix (p30). Also catches the lost `minimal` mapping (p28). Bug caught: invented effort values sent upstream.                                                                                                               |
| reads Anthropic-style max_input_tokens and input modality arrays                            | DELETE (a, duplicate) | `applies reasoningPattern...` fails on the same mutation (p27) and covers fallback `input` arrays.                                                                                                                                                                            |
| uses command credentials for %s discovery while preserving runtime expressions (4 cases)    | KEEP                  | Sole detector of unresolved header expressions (u1) and catches wrong anthropic auth (u3). Bug caught: a literal `!command` sent to the upstream. From 8f8ea06.                                                                                                               |
| does not make an unauthenticated discovery request when a command fails                     | REPLACE-cheap         | Sole detector of r3, and a real security path. Swap `piCliPath` to `bin.pi`. The lab confirms the same result on the real bin: fallback model, 0 requests, diagnostic present, secret absent. Reconsider the pinned "refreshed" notification.                                 |
| registers all three APIs and reads models from their configured upstream endpoints          | KEEP                  | Sole detector of base-URL normalization (r4) and API aliases (r5). Bug caught: doubled or missing `/v1` in discovery. Discovery only: see E1 for the chat path.                                                                                                               |
| enriches models from models.dev and caches the catalog separately                           | KEEP                  | Sole detector of variant-suffix lookup (u10). Catches lost re-registration (u7). Lines 377-388 are vacuous: the fixture has no droppable field, so disabling trimming still passes (r6). Add a droppable field.                                                               |
| uses a fresh cache without a network request and registers an expired cache without waiting | KEEP                  | Catches startup blocking on the network (p21). Regression for d584a81.                                                                                                                                                                                                        |
| refreshes expired caches after session_start and keeps the cache when a refresh fails       | KEEP                  | Sole detector of cache loss on a failed refresh (r10). Also catches a shared-document overwrite (p18). Lines 518-520 are vacuous: removing the once-only guard still passes (p20).                                                                                            |
| applies reasoningPattern, modelDefaults, and fallbackModels                                 | KEEP                  | Sole detector of r7. Catches lost fallback (p32). From f9688eb.                                                                                                                                                                                                               |
| injects the configured session affinity header with the pi session id                       | REPLACE-cheap         | Calls `emitBeforeProviderHeaders` directly, bypassing the real path (`sdk.js:206` to `models.js:443`). Assert the header on the wire. The lab shows it works today on all 4 APIs. It does catch handler removal (p31), but ignoring `options.headers` on Ollama passes (p10). |
| discovers Ollama models via /api/tags + /api/show and streams /api/chat                     | KEEP                  | Sole detector of r9. Real session and real stream parsing. Bug caught: broken capability discovery or NDJSON assembly.                                                                                                                                                        |
| registers refreshModels that rediscovers with the stored credential                         | KEEP                  | Sole detector of ignoring the stored credential (p19). Removing the registered key breaks 12 tests (p12), so d23cade is properly guarded.                                                                                                                                     |

### test/credential-command.test.ts

| Test                                                                 | Verdict               | Reason                                                                                             |
| -------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| preserves literal escapes and does not re-evaluate command output    | KEEP                  | Sole detector of p26. Bug caught: command output re-interpreted as an expression.                  |
| trims stdout without expanding the returned secret                   | DELETE (a, duplicate) | Trimming failure (u2) fails 7 tests including the one above. Non-expansion is also asserted there. |
| rejects invalid output or failure without exposing secrets (6 cases) | KEEP                  | Sole detector of secrets in errors (p22) and of multi-line or NUL output (p25). From 8f8ea06.      |
| times out a stuck command                                            | KEEP                  | Sole detector of p23. Bug caught: a stuck key helper hangs Pi startup. Costs 10 s of a 12 s suite. |
| honors cancellation                                                  | KEEP                  | Sole detector of p24. Only the pre-aborted case is tested.                                         |

### test/ollama-transcript.test.ts

| Test                                                                        | Verdict       | Reason                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| advertises active tools and carries real tool results into the continuation | KEEP          | Regression for 740a8a5, a real silent bug (p3).                                                                                                                                                                                                          |
| applies system section replacements and deletions and the current tool set  | KEEP          | Regression for 740a8a5 (p3). Catches stale prompt sections and removed tools.                                                                                                                                                                            |
| awaits raw stream observers before publishing their normalized events       | REPLACE-cheap | **Vacuous.** With `await` removed and a 30 ms observer, the order was `["observing-1","observing-2","delta","done"]`. `indexOf("observed-1")` is -1, so every `<` assertion passes (p33a-c). Assert the whole order array. The behaviour is in the spec. |
| reports a failed raw observer as a stream error                             | KEEP          | Sole detector of p33.                                                                                                                                                                                                                                    |

### Host contracts

Coverage key: **Bin** = real `pi` bin in a repo test. **SDK** = real in-process session. **Alias-CLI** = `dist/cli.js`. **Seam** = direct call that skips the host's path. **None** = no test. Package locations are in `pi-custom-provider/`; Pi types are in `pi-coding-agent/dist/core/extensions/types.d.ts` unless named.

| Contract                                                                                                                | Where                                                                      | Real-host coverage today                                                | If Pi changes it [I]                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendored `transformMessages`, `buildBaseOptions`, estimator                                                             | `pi-ai-internal.ts:126-403`                                                | None (p1, p2, v3 pass)                                                  | **SILENT. Already drifted (D1).** Also: upstream builds an explicit option list (`simple-options.js:18`); the vendored copy spreads `...options`. |
| `streamSimple` with `TranscriptContext`, `getCurrentTools`, `collapseSystemMessages`                                    | `discovery.ts:307`, `ollama.ts:157,472`; types:1456                        | SDK                                                                     | **SILENT.** 740a8a5 is exactly this: every tool declaration vanished.                                                                             |
| New message roles or content blocks                                                                                     | `ollama.ts:66-111` (the last branch assumes `toolResult`)                  | None                                                                    | **SILENT.** An unknown role is sent as a tool result.                                                                                             |
| `onPayload`, `onResponse` obligations                                                                                   | `ollama.ts:254,311`; types:1450-1453                                       | None (p4, p5 pass)                                                      | **SILENT.** `before_provider_request` and `after_provider_response` extensions stop working on Ollama only.                                       |
| Other stream options: `headers`, `maxRetries`, `signal`, `timeoutMs`                                                    | `ollama.ts:259-308`                                                        | None (p9, p10 pass)                                                     | **SILENT** for headers and retries.                                                                                                               |
| Options the adapter never reads: `sessionId`, `metadata`, `identity`, `cacheRetention`, `transport`, `env`, `telemetry` | absent from `ollama.ts` [V]                                                | None                                                                    | **SILENT.** New host options are dropped on Ollama.                                                                                               |
| Assistant event stream protocol                                                                                         | `ollama.ts:331-460`                                                        | SDK                                                                     | Mostly visible as a failed turn. Errors, length stop, and missing `done` are untested (p6, p7, p8).                                               |
| `before_provider_headers`, `ctx.model`, `ctx.sessionManager`                                                            | `index.ts:179-184`; types:721,1227; `sdk.js:206`; `models.js:443`          | Seam                                                                    | **SILENT.** Optional chaining hides a rename, so the header just disappears.                                                                      |
| `refreshModels` context: `allowNetwork`, `force`, `credential`, `signal`                                                | `index.ts:109-125`, `discovery.ts:256-266`; `pi-ai/dist/models.d.ts:15`    | SDK (p19, r8)                                                           | **SILENT.** Renamed `allowNetwork` means refresh never fetches. Changed credential shape means falling back to the config key.                    |
| Registered model fields: `thinkingLevelMap`, `compat`, `input`, `cost`, `contextWindow`, `maxTokens`                    | `discovery.ts:226-243`                                                     | SDK; `compat` None (p14 passes); `{off:null}` default None (p29 passes) | **SILENT.** Wrong effort values or context budget.                                                                                                |
| Config value grammar: `!`, `$!`, `$$`, `$VAR`                                                                           | `config.ts:128-156`, `discovery.ts:246-254`; `resolve-config-value.js:120` | None end to end (p16 passes). Lab passes today.                         | **SILENT-ish.** A literal key with `$` is mangled and looks like a bad key (401).                                                                 |
| `apiKey` needed for availability                                                                                        | `discovery.ts:300`                                                         | SDK (p12)                                                               | **SILENT.** Models vanish from `/model`. d23cade was this.                                                                                        |
| `authHeader` and the `!command` wrapper                                                                                 | `discovery.ts:282-304`                                                     | None on the chat wire (p15 passes). Lab passes today.                   | Visible 401.                                                                                                                                      |
| Runtime re-registration after `session_start`                                                                           | `index.ts:150,157`                                                         | SDK (u7)                                                                | **SILENT.** Stale catalog.                                                                                                                        |
| `session_shutdown` abort                                                                                                | `index.ts:204`                                                             | None (p17 passes), though the spec says "SHALL stop"                    | **SILENT.** Late registration.                                                                                                                    |
| Agent directory resolution (own copy, though Pi exports `getAgentDir`)                                                  | `config.ts:108-116`; `index.d.ts:2`                                        | None; tests always set the env var                                      | **SILENT.** No providers at all. Low likelihood.                                                                                                  |
| `PI_OFFLINE`                                                                                                            | absent                                                                     | None                                                                    | **Already not honoured (D3).**                                                                                                                    |
| pi-ai public helpers via `virtualModules`                                                                               | `ollama.ts:5-23`, `pi-ai-internal.ts:31`; `virtual-modules.js:27`          | Alias route only; never the real mapping with a config                  | Loads fine, then fails at first Ollama request as a stream error. Visible, but Ollama users only.                                                 |
| `registerProvider`, `registerCommand`, `ctx.ui.notify`                                                                  | `index.ts:50,187,200`; types:1382                                          | SDK; the `/refresh` success path is None (u8, u9 pass)                  | Signature changes are visible. A `/refresh` that stops updating is **SILENT**.                                                                    |
| Diagnostics via `console.warn` to stderr                                                                                | `discovery.ts:349-376`                                                     | Alias-CLI. Lab confirms on Bin.                                         | Cosmetic.                                                                                                                                         |

### Totals

| Verdict       | Cases | Approx. lines |
| ------------- | ----- | ------------- |
| KEEP          | 24    | 755           |
| REPLACE-cheap | 3     | 103           |
| REPLACE       | 0     | 0             |
| DELETE        | 2     | 26            |

Files that become empty: none. `pi-host.ts` needs its CLI path swapped.

## 6. pi-model-trace

### test/command.test.ts

All cases drive the real bin, which is the pattern to copy.

| Test                                                                                       | Verdict               | Reason                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| uses the current host without Pi on PATH and preserves thinking off in every probe         | KEEP                  | Regression for 740a8a5. Sole detector of `--no-tools` loss (t17). Catches PATH resolution (t11) and dropped `off` (t10).                                                              |
| does not let saved thinking defaults override the current session's off level              | DELETE (a, duplicate) | Strict subset of the test above. It uses the same saved `high` setting and asserts the same values. It fails only together with it (t10), and passes under t11 because Pi is on PATH. |
| honors an explicit executable override and reports execution failures                      | KEEP                  | Sole detector of ignoring `PI_MODEL_TRACE_BIN` (v1).                                                                                                                                  |
| rejects numeric output from failed child processes instead of scoring it                   | KEEP                  | Catches scoring failed output (t13). Spec scenario.                                                                                                                                   |
| reports excessive probe output instead of scoring its partial numbers                      | KEEP                  | Sole detector of t12.                                                                                                                                                                 |
| cancels running probes on session replacement without retrying or publishing a late report | KEEP                  | Sole detector of t14.                                                                                                                                                                 |

### test/fingerprint.test.ts

| Test                                                                        | Verdict               | Reason                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parses comma and space separated runs                                       | DELETE (a, duplicate) | No mutation fails it alone. Both separators are exercised by the tests below and by the command tests.                                                                                                                                            |
| drops out-of-range values without breaking the run                          | KEEP                  | Sole detector of t2. Bug caught: out-of-range values corrupt the count vector.                                                                                                                                                                    |
| splits runs on letters between numbers and keeps the longest                | KEEP                  | Sole detector of t1 and t3. Bug caught: prose numbers polluting the sample.                                                                                                                                                                       |
| keeps prose numbers out of the sampled sequence                             | DELETE (a, vacuous)   | **Passes with the letter rule removed (t1).** The prose number is about 490, so the range filter drops it regardless.                                                                                                                             |
| returns an empty array for prose-only text                                  | DELETE (a, duplicate) | The `"I refuse"` case below covers this path.                                                                                                                                                                                                     |
| builds a 355-dimension count vector                                         | KEEP                  | Sole detector of t6. Bug caught: mis-binned counts silently skew attribution. Can go once the golden test below exists [I].                                                                                                                       |
| creates three challenges with distinct expected counts in range             | REPLACE-cheap         | Sole detector of t9, but it restates constants and pins an id regex. Assert prompt, range, and distinct counts on the wire in `command.test.ts`.                                                                                                  |
| rejects outputs without enough numbers                                      | KEEP                  | Sole detector of t7.                                                                                                                                                                                                                              |
| attributes a synthetic sequence to some model with normalized probabilities | REPLACE-cheap         | **Passes with scoring inverted (t4) and with features ignoring the counts (t5).** Softmax normalizes anything. Replace with self-attribution: sample from each bank model's own counts. Lab: 24/24 top-1 now, 2/24 under t5, so it discriminates. |
| marks short outputs as invalid but still scores valid ones                  | KEEP                  | Sole detector of v2. Bug caught: one refusal loses the whole run.                                                                                                                                                                                 |

### Host contracts

| Contract                                                       | Where                                                      | Real-host coverage today                            | If Pi changes it [I]                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ctx.thinkingLevel` (optional in types)                        | `index.ts:68`; types:253                                   | Bin                                                 | **SILENT.** Probes use the saved default, skewing attribution. Covered today.                    |
| `--no-tools` semantics                                         | `index.ts:63`; `cli.md:125`                                | Bin (t17)                                           | **SILENT** tool use in probes. Covered today.                                                    |
| `-a` trust semantics                                           | `index.ts:64`; `cli.md:237`                                | None                                                | **SILENT.** Project-local providers may not resolve in probes.                                   |
| `ctx.signal` ("undefined when the agent is not streaming")     | `index.ts:213`; types:259                                  | None                                                | **SILENT.** A cancel from the UI might not stop probes.                                          |
| Print-mode stdout holds only the answer                        | `index.ts:87`                                              | Bin                                                 | **SILENT** only if extra digits join the number run. The longest-run parser mostly tolerates it. |
| `session_shutdown` via `new_session`                           | `index.ts:193`                                             | Bin (t14)                                           | **SILENT** late report. Covered today.                                                           |
| `pi.exec` options and result, including `truncated`, `killed`  | `index.ts:72-84`; `exec.d.ts:7-31`                         | Bin; the 10-minute timeout None                     | Mostly visible. Losing `truncated` would be **SILENT** partial scoring, but the test covers it.  |
| `getPackageDir` + `bin.pi` manifest                            | `index.ts:95-103`                                          | Bin                                                 | Visible error. Standalone branch at `:106-108` None (no binary here).                            |
| Other CLI flags: `-p`, `--no-session`, `--model`, `--thinking` | `index.ts:60-68`; `cli.md:69`                              | Bin                                                 | Visible `probe exited`.                                                                          |
| `ctx.waitForIdle`                                              | `index.ts:218`; types:309                                  | None beyond the idle case (t15 passes)              | Hang, or probes competing with a turn.                                                           |
| `ctx.model`, `getAvailable`, `find`                            | `index.ts:168-176`; types:246; `model-registry.d.ts:28-29` | `find` Bin; bare form and bare id None (t16 passes) | Visible error text.                                                                              |
| `pi.sendMessage` default rendering                             | `index.ts:266`; types:349                                  | Bin for content; TUI None                           | Cosmetic.                                                                                        |
| `ctx.ui.notify`, `setStatus`                                   | `index.ts:223-227`; types:91,95                            | notify Bin; setStatus None                          | Cosmetic.                                                                                        |
| Bank file via `import.meta.url` under jiti                     | `index.ts:20`                                              | Checkout only; packaged None                        | Visible `ModelTrace failed`.                                                                     |

Also uncovered, inside the package: retry after transport failure (t18) and the `expected_count` threshold (r12).

### Totals

| Verdict       | Cases | Approx. lines |
| ------------- | ----- | ------------- |
| KEEP          | 10    | 100           |
| REPLACE-cheap | 2     | 40            |
| REPLACE       | 0     | 0             |
| DELETE        | 4     | 21            |

Files that become empty: none.

## 7. pi-skill

### test/extension-load.test.ts

| Test                                                                    | Verdict    | Reason                                                                                                                                             |
| ----------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| loads through Pi's real extension loader and registers an input handler | DELETE (f) | Load-only duplicate of `npm run test:e2e`, importing the private `core/extensions/loader.js`. Removing the handler also fails 3 other tests (s14). |

### test/skill.test.ts

| Test                                                                       | Verdict               | Reason                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| discovers skills on disk and exposes them as real skill commands           | KEEP                  | Canary for the `getCommands` shape, and catches s13. Bug caught: a host rename silently disables `$skill`. Trim the Pi-only assertions. Line 234 compares Pi to Pi, so it should compare with `skill.baseDir`, which fails today (D2). |
| collects skill commands and ignores the real extension and prompt commands | DELETE (a, duplicate) | Same assertions as above (s13).                                                                                                                                                                                                        |
| expands a leading $skill token                                             | REPLACE-cheap         | **Pins dead `.text` and locks in D2** with a self-referential expected value. Replace with `$x` versus `/skill:x` parity on the wire, plus a `parseSkillBlock` round trip.                                                             |
| expands a token mid-sentence                                               | DELETE (a)            | Asserts dead `.text`. `injects a known skill...` already uses mid-sentence input.                                                                                                                                                      |
| expands multiple different skills                                          | DELETE (a, duplicate) | Dead `.text`. Order is covered by `injects one message per distinct skill`.                                                                                                                                                            |
| leaves unknown tokens and prices untouched                                 | KEEP                  | Bug caught: `$HOME` or `$9.99` treated as a skill. Move assertions from `.text` to `blocks`.                                                                                                                                           |
| keeps $$name literal as an escape                                          | KEEP                  | Sole detector of s12.                                                                                                                                                                                                                  |
| reports a missing skill file as failed and leaves the token                | KEEP                  | Sole detector of s17.                                                                                                                                                                                                                  |
| suggests all skills right after `$`                                        | KEEP                  | The only empty-query happy path (s13).                                                                                                                                                                                                 |
| filters by typed prefix                                                    | KEEP                  | Catches a skipped filter (q2).                                                                                                                                                                                                         |
| delegates when there is no `$` token or no match                           | KEEP                  | Sole detector of q3. Bug caught: the provider swallows `/` and file completion.                                                                                                                                                        |
| does not complete `$$name` escape                                          | KEEP                  | Catches r1. Note: the guard (q1) and the anchor (r2) are each redundant for this case.                                                                                                                                                 |
| delegates when no skills are loaded                                        | DELETE (a, duplicate) | Same path as the `$zz` case. Removing the guard passes (s4).                                                                                                                                                                           |
| replaces the $ prefix and adds a trailing space on applyCompletion         | KEEP                  | Sole detector of s15.                                                                                                                                                                                                                  |
| adds a trailing space when the cursor is at end of line                    | KEEP                  | Sole detector of s16.                                                                                                                                                                                                                  |
| delegates applyCompletion for non-$ prefixes                               | KEEP                  | Sole detector of q4. Drop the literal `cursorCol: 19` pin, which tests Pi (c).                                                                                                                                                         |
| injects a known skill as its own context message                           | REPLACE-cheap         | Calls `emitInput` directly, so no test in this package proves `session.prompt` reaches the handler or that the block precedes the prompt. Drive a real prompt and assert order on the wire (works in the lab).                         |
| injects one message per distinct skill in first-reference order            | KEEP                  | Sole detector of s11.                                                                                                                                                                                                                  |
| uses the input's delivery mode while the agent is streaming                | REPLACE-cheap         | Sole detector of s7, but feeds `streamingBehavior` by hand and never sends the user's text, which hides Q1. Use RPC `follow_up` and `steer`.                                                                                           |
| registers a renderer for standalone skill messages                         | REPLACE (e)           | Only checks `typeof function`. A renderer that always returns undefined passes (s1). TUI scenario below.                                                                                                                               |
| registers the skill autocomplete provider on session start                 | REPLACE (d)           | Swaps `addAutocompleteProvider` for a recorder. The real composition is `interactive-mode.js:550-556`; RPC's is a no-op (`rpc-mode.js:194`). Removing `triggerCharacters` passes (s2). TUI scenario below.                             |
| passes through input without $ or without matching skills                  | KEEP                  | Catches an unconditional injection (q8).                                                                                                                                                                                               |
| does nothing when no skills are loaded                                     | DELETE (a, duplicate) | Same outcome with the guard removed (s3). The test above covers the no-op.                                                                                                                                                             |

The autocomplete KEEPs hand-call the provider with Pi's real `CombinedAutocompleteProvider` as the fallback. They test package logic, but no editor is involved. The TUI scenario covers that part.

### Host contracts

| Contract                                                                                       | Where                                                           | Real-host coverage today                         | If Pi changes it [I]                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `input` event reached from `session.prompt`, result shape                                      | `index.ts:205-233`; types:929-949; `agent-session.js:1608,1670` | Seam: only `emitInput`                           | **SILENT.** `$skill` stays plain text and the model sees no instructions.                                                                 |
| Idle `sendMessage` lands before the user message                                               | `index.ts:227`; types:349                                       | None on the wire. Lab: correct today.            | **SILENT.** Instructions arrive after the prompt, or not at all.                                                                          |
| `getCommands` shape: `skill:` prefix, `source`, `sourceInfo.path`                              | `index.ts:38-53`; `slash-commands.d.ts:3-8`                     | SDK                                              | **SILENT.** Zero skills found, `$skill` does nothing.                                                                                     |
| `sourceInfo.baseDir` meaning                                                                   | `index.ts:48`                                                   | Pi-to-Pi comparison only                         | **SILENT. Already wrong (D2).**                                                                                                           |
| Block format parity with Pi                                                                    | `index.ts:91`; `agent-session.js:64,1757`                       | String pin, no parity check                      | **SILENT.** Parser mismatch means raw XML. Model-facing drift.                                                                            |
| `registerMessageRenderer`, `parseSkillBlock`, `SkillInvocationMessageComponent`, `setExpanded` | `index.ts:183-197`; types:1273                                  | None (s1). Lab TUI: works today.                 | **SILENT.** `custom-message.js:51-63` catches any throw and falls back to default rendering. A removed export loads fine, then does this. |
| `ctx.ui.addAutocompleteProvider` composition                                                   | `index.ts:200`; types:160; `interactive-mode.js:550-556`        | Recorder only. Lab TUI: works today.             | **SILENT.** The popup never appears.                                                                                                      |
| `triggerCharacters`                                                                            | `index.ts:122`; `pi-tui autocomplete.d.ts:19`; `editor.js:306`  | None (s2)                                        | **SILENT.** `$` no longer opens the popup.                                                                                                |
| Provider interface: explicit wrapper, not a spread                                             | `index.ts:121-179`                                              | Partial; `shouldTriggerFileCompletion` None (s6) | **SILENT.** New optional provider methods are not forwarded.                                                                              |
| `deliverAs`, `streamingBehavior`                                                               | `index.ts:224-225`; types:938                                   | SDK with hand-fed value                          | Queue misuse. Q1 exists today.                                                                                                            |
| `stripFrontmatter`                                                                             | `index.ts:90`                                                   | SDK                                              | Removed export falls into the `catch`, giving a misleading "Failed to read skill" for every skill.                                        |
| `fuzzyFilter`                                                                                  | `index.ts:144`                                                  | Real function, hand-called                       | Removed export throws while typing, so the popup likely fails.                                                                            |
| `ctx.ui.notify` in the handler                                                                 | `index.ts:213`                                                  | None (s8). Lab passes over RPC.                  | Cosmetic.                                                                                                                                 |

### Totals

| Verdict       | Cases | Approx. lines |
| ------------- | ----- | ------------- |
| KEEP          | 13    | 175           |
| REPLACE-cheap | 3     | 76            |
| REPLACE       | 2     | 17            |
| DELETE        | 6     | 84            |

File that becomes empty: `pi-skill/test/extension-load.test.ts`.

## 8. Overall totals

| Verdict       | custom-provider | model-trace | skill | All |
| ------------- | --------------: | ----------: | ----: | --: |
| KEEP          |              24 |          10 |    13 |  47 |
| REPLACE-cheap |               3 |           2 |     3 |   8 |
| REPLACE       |               0 |           0 |     2 |   2 |
| DELETE        |               2 |           4 |     6 |  12 |
| Cases         |              29 |          16 |    24 |  69 |

Approximate test-body lines: KEEP 1030, REPLACE-cheap 219, REPLACE 17, DELETE 131. Shared setup and helpers are not counted, and they mostly stay.

## 9. New E2E scenarios for the proposal

Tagged **fails today** when the lab showed a defect. All were run in the lab unless tagged "not run". All can use the harness in `pi-model-trace/test/command.test.ts`: real `bin.pi`, RPC, isolated agent directory, local HTTP server.

**Highest value**

1. **Skill parity (fails today, D2).** `$x` versus `/skill:x` give identical blocks on the wire. The block precedes the prompt.
2. **Ollama cross-model history (fails today, D1).** Thinking from model A must not appear in the request to model B.
3. **Vendored differential test (fails today, D1).** Feed the same fixture through `pi-ai-internal.ts` and the pinned `pi-ai/dist/api/*`, and require equal output. Not run as written; D1 shows it would fail. It makes every pin bump flag drift.
4. **TUI through a pty.** `$` opens a popup listing `$known`; submitting renders `[skill] known`, not raw XML. Template: `pi-ask/test/tui-plane.ts`. Needs an exact `node-pty` dev pin and a `none` intent for `pi-skill`. Lab confirms popup and block on the real bin; the expand toggle and completion insertion were not run.
5. **Native APIs round trip.** Each of 3 APIs × 4 key forms (command, literal `$`, `authHeader`, `authHeader` + command): model listed in `get_available_models`, correct path and auth on the chat request, affinity header present. Lab: 12/12 pass today, and it would cover p10, p15, p16.

**Decisions needed first**

6. **Offline (fails today, D3).** No request under `PI_OFFLINE=1`. The owner should confirm this is the intended contract.
7. **Queued `$skill` (Q1).** RPC `follow_up` and `steer`. The owner should choose the desired turn count before the test is written.

**Filling known gaps (none run)**

8. **Ollama failures.** HTTP 500, 429 with retry-after, stream without `done`, abort mid-stream, `length` stop, image in a tool result, `think:false` default (p6, p7, p8, p9, p11, r11).
9. **Ollama hooks.** A second extension's `before_provider_request` rewrite and `after_provider_response` take effect (p4, p5).
10. **`compat` and the `{off:null}` default** reach the native request (p14, p29).
11. **`/refresh-custom-provider-models` success path.** New models appear in `get_available_models` (u8, u9).
12. **Model-trace command forms.** Bare `/model-trace`, bare id, ambiguous id, unknown id, retry after failure, command during a held turn (t15, t16, t18).
13. **Packaged install.** Pack, `pi install`, then actually use the feature with config present. `test:e2e` runs from the checkout. The release plan does load the installed tarball (`docs/releases.md:151`), but only answers `get_commands` with an empty agent directory. A missing source file imported statically would fail there [I]. A missing `data/unified_bank.json` would not, because the file is read only when the command runs.

**Repository level (none run)**

14. **`test:e2e` should assert expected commands**, and give custom-provider a config, since it currently proves imports only.
15. **A scheduled run against Pi `latest`.** Peers are `"*"` and pinned tests cannot see a user's newer Pi. Removed exports do not fail at load, so this run must exercise features, not just load them.
