# Design

## Context

See `proposal.md` for motivation and `specs/` for requirements. Per-test verdicts, host contract tables, and evidence labels are in `audit/`. Those reports were produced by read-only audit agents; the defect register below records what was independently re-verified.

The Pi test surface today: 56 test files, 720 cases, about 19,300 lines, all passing in under a minute. These facts shape the approach.

**Tests do not run what users run.** Pi's published `bin.pi` is `dist/bundle/cli.js`, which sets `isBundledNode` and resolves host packages through jiti `virtualModules` with `tryNative: false`. The helpers `pi-continue/test/pi-rpc.ts` and `pi-custom-provider/test/pi-host.ts` spawn `dist/cli.js`, which takes the alias route instead; in-process `createAgentSession` does the same. `npm run test:e2e` uses the real bin but loads from the checkout, so workspace `node_modules` hides missing `files` entries and unmapped host imports. It also runs with no configuration, so `pi-provider-sub2api` and `pi-custom-provider` return before registering anything and pass on `{"commands":[]}`.

**`pi install` is cheap and faithful.** Verified on Pi 1.5.0 with all eight packages: `pi install npm:@indexyz/<name>@file:<tarball>` needs no registry, installs no peers, and takes about 100 ms of npm time per package, and also works with `npm_config_offline=true` and an isolated `HOME`. No Pi package has runtime `dependencies`. A full configured RPC lifecycle (prompt, `set_model`, `new_session`, fork) with all eight co-installed passes, and a print-mode turn exits in about 200 ms.

**The root `node_modules` is not one Pi.** Pi 1.5.0 is at the root, but the hoisted `pi-ai` and `pi-tui` there are 1.4.0, pulled in by dsh hosts and `pi-ask`'s legacy alias; the pinned 1.5.0 copies nest under each package and under `pi-coding-agent`. Anything reading the host's files must resolve from the package, not the root. The defect evidence below was rechecked against the 1.5.0 copies for this reason.

**The official installer uses the npm package.** `https://pi.dev/install.sh` runs a managed `npm ci` of `@earendil-works/pi-coding-agent`, so the bundled-node entry above is the mainstream shape.

## Goals / Non-Goals

**Goals:**

- Prove what users install, through the bin they run, against local servers.
- Detect Pi breakage early, including silent breakage, through a rehearsal against the newest release.
- Leave a package test suite where each remaining case has a reason to exist.

**Non-Goals:**

- Changing anything under `dsh-*/`, DSH requirements, or `checkDsh`. `scripts/release/test/` is out of scope too: the release engine's own installed-tarball load is unchanged.
- Live endpoints or credentials. Replacing kept pure-logic tests with slower process tests. A coverage target.
- The standalone Bun binary and Windows; see Risks.
- Removing the `pi-ask` Pi 1.4.0 fallback. By owner decision it stays for a separate change, so its five tracker cases and two legacy PTY cases stay as they are, and no new fallback scenario is added.

## Decisions

### D1. Black-box suite at the repository root

`scripts/e2e/pi/` holds a small harness plus one `<package>.e2e.ts` per package and a `cross-package.e2e.ts`, run with `node --test`, Node's runner already used for repository tooling.

It imports no package source and no host package, only `node-pty` for terminals. Pi internals can therefore move without breaking the harness; only a package's own dependence on them can fail.

_Alternative: `<name>/test/e2e/` per package._ Rule 2 favours it, but pack, install, and co-install are inherently cross-package, and a shared harness cannot be reached from a self-contained package without importing outside its directory. The five near-identical helpers today show the cost of per-package copies. Removing a package gains one step: delete its scenario file and its registrations entry. This needs a matching amendment to the `real-environment-testing` requirement that a conversion lives in the package's `test/` tree; see the delta.

_Alternative: Vitest at the root._ Adds a root dependency and configuration for no capability `node --test` lacks.

Root tooling meets the strict profile, including `prefer-readonly-parameter-types`. This is a real cost; `scripts/release/test/` shows it is workable.

### D2. Harness shape

- **`world`**: each `.e2e.ts` file packs the packages it needs (cheap, and `node --test` isolates files in processes); each test installs tarballs into a fresh agent directory with `pi install`, writes configuration, and refuses a temporary root under any `node_modules` tree. It keeps tarballs for the scenario's lifetime because `settings.json` records their literal `file:` path, and no scenario runs `pi update`. It sets `HOME`, `npm_config_cache`, and `npm_config_logs_dir` under the world root, since `pi install` shells out to npm and otherwise writes `~/.npm/_logs` (observed), and sets `npm_config_offline=true` during install.
- **`pi`**: spawns the published bin. Print and JSON runs close stdin (a piped stdin that stays open blocks `pi -p`, which an early probe hit). RPC parses strict JSONL. All spawns use process groups and bounded timeouts.
- **`servers`**: `node:http` protocol servers for OpenAI completions, OpenAI Responses and Codex (including zstd bodies), Anthropic Messages, Ollama NDJSON, relay discovery, billing, and usage, each recording requests and able to inject failures.
- **`pty`**: `node-pty` plus OSC 7501 parsing, adapted from `pi-ask/test/tui-plane.ts`.

**Network modes.** One rule, by whether a package has network traffic of its own. Every scenario sets `PI_SKIP_VERSION_CHECK=1` and `PI_TELEMETRY=0`. Scenarios for packages with no traffic of their own (`pi-ask`, `pi-autocompact`, `pi-continue`, `pi-idle-compression`, `pi-model-trace`, `pi-skill`) and X3 run with `PI_OFFLINE=1`; their model comes from `models.json`. Scenarios for `pi-provider-sub2api` and `pi-custom-provider`, and X2, run without it, because after defect 4 is fixed offline correctly suppresses the discovery, billing, and usage requests they need from local servers. Three exceptions run offline by design: the offline assertions of C4 and P7, which set both `PI_OFFLINE=1` and `--offline` and assert no request arrives, and P8.

On online scenarios, package traffic reaches loopback; Pi's own best-effort catalog refresh (`https://pi.dev`, with no setting to redirect it) may leave the machine and its failures are swallowed. So no online scenario asserts a value derived from Pi's catalog; those assertions belong to P8, for which `world` writes `sub2api-models.json` and `models-store.json` into the scenario's own agent directory before it starts.

A package's own default external endpoints are configured away too: `pi-custom-provider` fetches `https://models.dev` by default at load, so its worlds set top-level `"modelsDev": false`, and a scenario whose subject is that enrichment points `apiURL` and `modelsURL` at its local server.

**Isolation granularity.** Packing is per file, as above. Each test builds its own agent, session, home, npm cache, and working directories and its own servers.

RPC has no `/reload`, so reload scenarios load a tiny fixture extension that calls `ctx.reload()`, the same mechanism an installed user reaches through the TUI.

### D3. Load check moves to the installed shape; configured checks live in the suite

`scripts/e2e/plugins.ts` keeps discovery, aggregation, the pin check, and `checkDsh` unchanged. `checkPi` packs and installs instead of passing `--extension <checkout path>`, and the checkout path is removed. A new `--kind pi` filter lets the rehearsal and Pi-only verification skip DSH builds and smoke checks, which need `pnpm` and the dsh host; the default run still covers both.

Configured registration (X2) cannot live there: `plugins.ts` uses `spawnSync`, which blocks the event loop a local server would need. It belongs in the async suite. The two checks are complementary: `test:e2e` proves a fresh, unconfigured install loads; `test:e2e:pi` proves configured behaviour.

### D4. The rehearsal uses the documented upgrade path

`.github/workflows/pi-host-rehearsal.yml` runs daily and on `workflow_dispatch` with an optional `pi-version` input (default `latest`). A short script sets exact `@earendil-works/*` pins in Pi workspace manifests to that version, leaving `pi-ask`'s legacy alias and every `dsh-*` manifest alone, and runs `npm install`. It then runs Pi workspaces' typecheck and tests, `plugins.ts --kind pi`, and `test:e2e:pi`.

This reuses "Upgrade Pi" in `docs/workflow.md`, so the existing pin check passes without a bypass flag and the rehearsal exercises the path a real upgrade takes. Typecheck catches removed exports and renamed events; this matters because a named import of a missing export loads under the bin as `undefined` and only fails at first use (verified).

_Alternative: `npm install --no-save` of the host at the root._ Rejected: exact workspace dev pins make npm nest the old version beside each package, so typecheck would still see the pin.

_Alternative: an environment override for the bin._ Rejected: adds a bypass path to the pin check and covers less.

Daily is justified by 14 Pi releases in six weeks. It holds `contents: read`, no secrets, and pushes nothing. Failures surface as a failed scheduled run; automated issue filing is left out as speculative.

### D5. Drift guard for vendored code stays a package test

`pi-custom-provider/pi-ai-internal.ts` vendors `transformMessages`, `buildBaseOptions`, and estimators because Pi's extension view exports none of them (verified on 1.5.0). A test in `pi-custom-provider/test/` runs the same fixtures through the vendored copy and the pinned host's `@earendil-works/pi-ai/api/*` subpaths, resolved from the package, and fails on any difference. It also asserts the resolved `pi-ai` version equals the package's pin, because a resolution reaching the root's 1.4.0 copy would compare against the wrong host. Those subpaths are public npm exports but unmapped for extensions at runtime, so this works in a test and not in the extension.

A moved file fails loudly at a pin bump or in the rehearsal, which is the signal wanted. The `real-environment-testing` delta permits this comparison explicitly: it runs two real implementations and fakes nothing. Should Pi expose these functions, the vendored file and this test both go.

`pi-provider-sub2api`'s private runtime is guarded differently because it runs in the extension itself: scenario P2 asserts the capability in the installed shape.

### D6. Order: scenario first, deletion second

Every package follows the same order, which also satisfies the regression-guard requirement:

1. Fix confirmed defects in a package-scoped OpenSpec change, with the failing scenario first.
2. Add the package's other scenarios and record each mutation proof.
3. Delete the REPLACE cases those scenarios cover.
4. Delete DELETE cases.

Packages run by dependency, then roughly by size, so harness flaws surface cheaply before `pi-provider-sub2api`; `pi-autocompact` precedes `pi-idle-compression` because I1 co-installs it.

**Ownership across OpenSpec roots.** This root change owns the harness and scenario files. A package-scoped fix change lists its own scenario edit in its tasks and lands it in the same commit as the fix, editing `scripts/e2e/pi/<package>.e2e.ts`; "same change" in the spec means that commit. Non-defect scenarios land under this change.

**Audit precedence.** `audit/` holds the original verdicts. Where this design's disposition differs (the Cleanup table and exclusions), the design wins.

### D7. Mutation proofs are recorded, not committed

`verification.md` in this change records, for each scenario, the regression applied to a scratch copy and the observed failure. Running this continuously would be speculative infrastructure; once per scenario is what shows it is not a test for testing's sake.

## Scenario catalog

"Today": **passes** (run once by a throwaway probe), **FAILS** (a confirmed defect below), or **not run** (no probe has executed it yet, so it may surface something new). Audit IDs are in `audit/`.

| ID  | Scenario                                                                                                                                                                                         | Failure mode and evidence                                                                                         | Replaces            | Today          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------- | -------------- |
| X1  | Each package, packed and installed, no config, loads (`plugins.ts`)                                                                                                                              | Files or host mapping break for installed users only: [#11518], [#11452], [#11219], e163ab1                       | Load-only tests     | passes         |
| X2  | Each package with config registers expected commands and models                                                                                                                                  | Today's check passes on an empty command list                                                                     | Checkout load tests | passes in part |
| X3  | All eight installed: print, JSON, RPC lifecycle, no extension error, bounded exit                                                                                                                | [#11472], [#10025], [#8814], [#11336]                                                                             |                     | passes         |
| P1  | sub2api routing and auth per API, token forms, server tools on the wire                                                                                                                          | Silent dispatch and hook contracts, `provider-composer`                                                           | S1, S13             | passes in part |
| P2  | Native compaction in the installed shape: `/openai-compress` listed, checkpoint persisted, next request replays the opaque item                                                                  | Silent loss of history; private pi-ai layout: [#11219], df7b884, 2a4a0d9                                          | S2, S3, S10         | passes in part |
| P3  | Compaction failure: fallback before a checkpoint, cancel after one                                                                                                                               | README promise; a broken path loses history                                                                       | S4                  | passes in part |
| P4  | Retry and overflow matrix                                                                                                                                                                        | **Defect 7**, c07193a, 56177b3                                                                                    | S5                  | **FAILS**      |
| P5  | Reload matrix, including API switch and provider removal                                                                                                                                         | **Defect 8**                                                                                                      | S6                  | **FAILS**      |
| P6  | Request modes on the wire, save, restart                                                                                                                                                         | `before_provider_request` is a silent chain; 616f66b                                                              | S7                  | passes in part |
| P7  | Discovery cache across two processes, refresh, partial failure; offline cold start makes no request, and an offline turn from a seeded cache sends no usage request                              | Startup regression, 8e30d63; **Defect 4**                                                                         | S8                  | **FAILS**      |
| P8  | Offline, with a seeded discovery cache: metadata from `models-store.json` and catalog fallback, compared in one process state with the built-in model Pi reports over RPC `get_available_models` | Silent wrong limits and prices: d7ea5ac, d228e24                                                                  | S9                  | passes in part |
| P9  | xAI inventory, relay-supplied metadata, one turn, local tool replay, textual compaction                                                                                                          | 1acf1ae, 33db6ad                                                                                                  | S11                 | passes in part |
| P10 | Footer in a real terminal                                                                                                                                                                        | `setFooter` is a no-op in RPC; 5aceda0, 85a8342, b229d5a                                                          | S12                 | not run        |
| C1  | Native APIs and key forms round trip; session affinity header, `compat`, and the `{off:null}` default reach the wire                                                                             | d23cade, 12 combinations; `before_provider_headers` optional chaining hides a rename (silent)                     | Scenarios 5, 10     | passes in part |
| C2  | Ollama: tools and system on the wire, second extension's hooks, 500, 429, missing `done`, abort                                                                                                  | 740a8a5 silently dropped every tool                                                                               | Scenarios 8, 9      | passes in part |
| C3  | Ollama cross-model history                                                                                                                                                                       | **Defect 5**                                                                                                      | Scenario 2          | **FAILS**      |
| C4  | Offline cold start; refresh success path                                                                                                                                                         | **Defect 4**                                                                                                      | Scenarios 6, 11     | **FAILS**      |
| K1  | `$skill` and `/skill:` give identical blocks before the prompt; a skill in queued `steer` and `follow_up` uses the input's delivery mode, with no assertion on turn count                        | **Defect 2**; `input` path is only called by hand today                                                           | Scenario 1          | **FAILS**      |
| K2  | `$` popup and `[skill]` renderer in a real terminal                                                                                                                                              | Silent `triggerCharacters` and renderer contracts                                                                 | Scenario 4          | passes         |
| T1  | Installed `/model-trace` reads its data bank; command forms                                                                                                                                      | Data file is read at runtime only, so a load check cannot see it missing                                          | Scenarios 12, 13    | not run        |
| A1  | Boundary compaction over RPC, tool-group retention, and summary request options                                                                                                                  | **Defect 3**, [#11472], 740a8a5                                                                                   | Priorities 2, 4, 6  | **FAILS**      |
| A2  | Print mode with a saved limit persists a compaction                                                                                                                                              | Silent boundary contract on the non-interactive path: a dropped entry loses the compaction with no error; 740a8a5 | Priority 7          | passes         |
| I1  | Idle timer compacts once, co-installed with autocompact                                                                                                                                          | [#11706]: the package's guards prevent a second summary                                                           | Priorities 8, 10    | passes         |
| I2  | Print exit with an armed timer                                                                                                                                                                   | [#8814]                                                                                                           | Priority 9          | passes         |
| N1  | `/continue` in print and JSON modes                                                                                                                                                              | **Defect 1**, [#11011] closed not planned, so the package must handle it                                          | Priority 1          | **FAILS**      |
| N2  | Abort during a real tool execution, retry from the tool result                                                                                                                                   | Silent `SessionEntry` contract: a wrong retry point drops or repeats tool work; no suite runs real tool calls     | Priority 5          | not run        |
| N3  | Real 500, repeated `/continue`, during in-flight idle compaction                                                                                                                                 | [#10982]; first `/continue` after a failed retry has no other coverage                                            | Priority 10         | passes in part |
| Q1  | Answer a question, Enter on review; answer reaches the model                                                                                                                                     | No test ever answers a question                                                                                   | E1                  | passes         |
| Q2  | Custom submit key; `@` file suggestion                                                                                                                                                           | 5d7ccc8; silent `triggerCharacters`                                                                               | E2, E3              | passes         |
| Q3  | SIGKILL with a form open, resume, submit or cancel; RPC and `/new` do not reopen                                                                                                                 | Silent session-entry contract; 4de596a                                                                            | E4, E5, E6          | passes in part |
| Q4  | `/ask-settings` writes the file                                                                                                                                                                  | Silent: settings UI runs on `ctx.ui.custom`, so a broken save loses the user's change without an error            | E7                  | passes         |
| Q5  | `/ask:replay`; remote answer over real `pi.events`                                                                                                                                               | Silent event bus contract                                                                                         | E8, E9              | passes in part |
| Q6  | `/answer` with chat-model-only credentials, scoped models, keyless provider                                                                                                                      | **Defect 6**                                                                                                      | E10                 | **FAILS**      |
| Q7  | Commands in RPC mode notify and make no model request                                                                                                                                            | [#10724]: `custom()` is a no-op in RPC                                                                            | E11                 | passes         |
| Q8  | Dismiss guard                                                                                                                                                                                    | Data loss of typed answers                                                                                        | E13                 | passes in part |
| Q9  | Preview pane; 12, 20, and 30 columns with CJK and emoji                                                                                                                                          | Renderer overflow crashes the TUI                                                                                 | E15, E16            | passes in part |
| Q10 | Bundled skill loads after `pi install`                                                                                                                                                           | `files` plus resource discovery                                                                                   | E18                 | not run        |

**Considered and excluded.**

| Candidate                                        | Why not                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#11287] providers wiped by reload               | Does not apply: it concerns `registerApiProvider`, and these packages use `registerProvider` (reloads with unchanged config verified). Pi has no settings watcher.                                                                                                                                                              |
| [#10704], [#10705], [#11673], [#10267]           | Repro shapes do not occur here: no package awaits `ctx.compact()` inside an `agent_settled` handler then triggers a turn (read from code and grep). #10704 is still open and sits near N3 and the defect 1 fix, which adds a `waitForIdle`, so a failure there is checked against it before being recorded as a package defect. |
| Invalid `sub2api.json` (S14)                     | No backing beyond hypothesis: no report or regression, and no audit row depends on it.                                                                                                                                                                                                                                          |
| Bell count (E14), multi-line custom answer (E19) | No named failure mode. Their two REPLACE rows are deleted instead.                                                                                                                                                                                                                                                              |
| Pi 1.4.0 fallback variants (E17)                 | Out of scope by owner decision.                                                                                                                                                                                                                                                                                                 |
| 300-second compaction timeout (796eeb2)          | Would need over three minutes of real waiting per run for a constant. Accepted gap.                                                                                                                                                                                                                                             |

## Defect register

Verification column: **wire** means reproduced by this proposal's author through the installed package or real bin; **source** means read in the code. Audit evidence is in `audit/`.

| #   | Package                                     | Defect                                                                                                                                                                                                  | Verification                                                                                                                 | Fix direction                                                                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pi-continue`                               | `/continue` makes 0 model requests in `-p` (exits 1, re-printing the old error) and `--mode json` (exits 0 silently); RPC makes 1                                                                       | Wire                                                                                                                         | `await ctx.waitForIdle()` after `pi.sendMessage` (audit confirmed on a patched copy)                                                                                                      |
| 2   | `pi-skill`                                  | `$known` says references are relative to the agent directory; `/skill:known` says the skill directory                                                                                                   | Wire; `index.ts:48`                                                                                                          | Use `dirname(filePath)`; correct `expands a leading $skill token`, which pins the bug                                                                                                     |
| 3   | `pi-autocompact`                            | Boundary summary request lacks `max_completion_tokens` and `reasoning_effort`; turns carry both                                                                                                         | Wire; cause inferred                                                                                                         | `compaction.ts:51` passes `modelRegistry.stream` where the summarizer sets simple options. Confirm the cause in the fix change                                                            |
| 4   | `pi-custom-provider`, `pi-provider-sub2api` | Under `--offline` and `PI_OFFLINE=1`, custom-provider sends `GET /v1/models` on cold start, and sub2api sends Codex discovery, billing, and usage requests, contrary to `docs/environment-variables.md` | Wire, both packages; no `PI_OFFLINE` reference in sub2api's code                                                             | Honour offline for every automatic request: startup and background discovery, and sub2api's billing, quota, and per-turn usage refreshes. Model requests the user asks for are unaffected |
| 5   | `pi-custom-provider`                        | Cross-model thinking becomes visible assistant text on Ollama                                                                                                                                           | Source: `pi-ai-internal.ts:285-293` versus the 1.5.0 `transform-messages.js`; wire by audit                                  | Align with upstream; add the D5 drift test                                                                                                                                                |
| 6   | `pi-ask`                                    | `/answer` errors `Provider is not configured: anthropic` on default config without Anthropic credentials, with no fallback                                                                              | Source: `model-registry.js:34-42` returns `ok: true` with no credentials, `answer-extraction.ts:67` trusts it; wire by audit | Use `hasConfiguredAuth`                                                                                                                                                                   |
| 7   | `pi-provider-sub2api`                       | `stream_read_error` ends the turn after one attempt                                                                                                                                                     | 1.5.0 classifier called directly: `false`; `upstream_stream_read_error`: `true`; wire by audit                               | By owner decision, normalize the error so Pi retries it; correct README lines 417 and 423 in the same change                                                                              |
| 8   | `pi-provider-sub2api`                       | After `/reload`, an API switch away from Codex still sends the old token (B, while quota GETs use C); a removed provider stays listed and receives prompts                                              | Wire for API switch; provider removal by audit; `model-runtime.js:672-678` merge read                                        | Make the re-registration replace the stale handler and unregister removed providers (`pi.unregisterProvider` exists)                                                                      |

| 9 | `pi-ask` | With auto-submit on, a digit answer leaves the form on review and the model waiting; Enter submits. Found while writing Q4 | Wire: scenario timed out before the fix | `finish: true` from the number shortcut |

**Recorded, not fixed here** (no scenario asserts either way, awaiting the owner's decision): a queued `$skill` takes its own model turn, where a probe showed that embedding the block in the queued text delivers both in one turn and `deliverAs: "nextTurn"` silently loses the block; and autocompact sends a paid summary after a failed turn because `checkBoundary` ignores `event.outcome`.

**Found during implementation, left in place** because they are runtime changes beyond this plan: `pi-continue`'s `context` hook has no effect on the wire on Pi 1.5.0, and `pi-custom-provider`'s `!printf` authorization wrapper is no longer needed. Each package's `verification/` record lists regressions that turned out to be equivalent.

## Cleanup disposition

| Package               |   Cases |  DELETE |  To E2E |   Stays | Files removed                                                                                                                                                                                               |
| --------------------- | ------: | ------: | ------: | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi-ask`              |     211 |      52 |      23 |     136 | `answer-commands`, `ask-settings-command`, `autocomplete`, `dismiss-guard`, `dismiss-notice-behavior`, `render-question`                                                                                    |
| `pi-provider-sub2api` |     292 |      40 |     155 |      97 | `anthropic-limits`, `codex-compaction`, `codex-integration`, `codex-manifest`, `extension-load`, `model-cache`, `model-metadata`, `package-manifest`, `request-mode-commands`, plus helper `chat-models.ts` |
| `pi-autocompact`      |     102 |      13 |       0 |      89 |                                                                                                                                                                                                             |
| `pi-idle-compression` |      33 |       7 |       1 |      25 |                                                                                                                                                                                                             |
| `pi-continue`         |      13 |       5 |       1 |       7 | `extension-load`                                                                                                                                                                                            |
| `pi-custom-provider`  |      29 |       2 |       1 |      26 |                                                                                                                                                                                                             |
| `pi-model-trace`      |      16 |       4 |       0 |      12 |                                                                                                                                                                                                             |
| `pi-skill`            |      24 |       6 |       5 |      13 | `extension-load`                                                                                                                                                                                            |
| **Total**             | **720** | **129** | **186** | **405** | **17 files and one helper**                                                                                                                                                                                 |

**How audit REPLACE-cheap rows land.** In `pi-provider-sub2api` they drop a stubbed host, so they become scenarios. Elsewhere they mostly need only a corrected entry point or assertion, so they stay in the package:

| Package              | Stays on the corrected form                                                                                                                                                                                       | Moves to a scenario                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pi-continue`        | 6 of 7, on `bin.pi`, including the guards for 05143b3, 173d51d and the real-abort `waitForIdle` case. The seventh, the context-history case, passed with the hook disabled and was removed; see `verification.md` | None; the REPLACE row "failed turn through a persisted marker" goes to N3's restart scenario |
| `pi-custom-provider` | "does not make an unauthenticated discovery request" on `bin.pi`; "awaits raw stream observers" corrected                                                                                                         | Affinity header goes to C1                                                                   |
| `pi-model-trace`     | Challenge assertion on the wire; synthetic attribution becomes self-attribution                                                                                                                                   | None                                                                                         |
| `pi-autocompact`     | Effective settings compared with the real `SettingsManager`                                                                                                                                                       | None                                                                                         |
| `pi-skill`           | None                                                                                                                                                                                                              | All 3 go to K1; the 2 REPLACE rows go to K2                                                  |

Corrections while cases are moved, not separate work:

- **Vacuous tests get fixed or removed:** `awaits raw stream observers`, `keeps prose numbers out of the sampled sequence`, `attributes a synthetic sequence...` (replaced by a self-attribution check), `dismiss-notice-behavior`, and `sub2api.test.ts` L930, L1567, L1619.
- **Catalog constants become runtime comparisons:** pinned prices and limits (`cost: 5`, `272000`) fail on Pi upgrades with no user impact. P8 compares with the built-in model Pi reports over RPC instead, which keeps the harness free of host imports. Verified offline: `get_available_models` lists openai and anthropic models with cost and limits only when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` hold placeholders (44 and 17 models), and these inert values are the only dummy credentials in the suite. P8 stays offline because a refresh could otherwise feed the two sides of its comparison from different sources.
- **Entry-point swaps:** `pi-continue/test/pi-rpc.ts` and `pi-custom-provider/test/pi-host.ts` resolve `bin.pi` as `pi-model-trace/test/command.test.ts` already does. The audit ran only part of `pi-continue`'s cases on the bundle; the swap may surface differences. `pi-continue`'s context-history case calls `emitContext` directly, so it moves its assertion to the request at the local server.
- **`pi-provider-sub2api` KEEP cases:** 25 swap the fake `pi` for a direct `loadRelayConfigs` call. No published file changes to enable a test: parser cases go through a relay fixture rather than exporting `parseRemoteCompactionStream`.

## Risks / Trade-offs

- **[Rewriting 186 cases costs far more than deleting them]** → Table-driven rows collapse into few processes, per-process cost is measured at 0.2 to 2.3 seconds, and the order in D6 lets work stop after any package without losing coverage. `pi-provider-sub2api` is most of it; an aggregate runtime has not been measured, and the first package groups will show whether the suite stays within about five minutes in CI, and `node --test` concurrency can be set from that measurement.
- **[Scenarios marked "not run" may find new defects]** → A new defect goes into the register and its scenario follows the same rule: it lands with a fix or not at all.
- **[The rehearsal goes red for reasons unrelated to users, such as a kept real-host test or `expect(stderr).toBe("")` on a new warning]** → That is what it is for, once. Noisy assertions get fixed rather than ignored; a run that is routinely red has no value.
- **[E2E flakiness from timing, PTYs, and the beta `node-pty`]** → Assertions wait for events rather than sleeping; a hung process is killed by group. The existing PTY tests passed 10/10 repeats in the audit. `node-pty` already runs in CI through `pi-ask`.
- **[Mutation proofs age]** → Accepted. They show a scenario could detect its failure when written, not forever.
- **[Standalone Bun binary coverage gap]** → Not covered. Bun's module handling has differed ([#10228], [#6557]), and `pi-provider-sub2api`'s fallback returns `undefined` on a host with no files on disk, which would silently remove native compaction. Release assets exist per platform, but running the downloaded binary for this research was denied by the session's safety classifier, so its behaviour is **unverified**. A probe needs the owner's authorization and may become a follow-up rehearsal job.
- **[Windows coverage gap]** → CI is `ubuntu-latest` and [#11219] was Windows. Accepted for now; the installed-shape check covers its class of failure on Linux, not path-specific variants.
- **[`pi-ask`'s retained fallback tests use a hand-built event registry]** → Named narrowly in the delta as a retained exception until the fallback goes, so no new test can claim it.
- **[Removing tests hides a regression the audit misjudged]** → Most verdicts are read from code, with mutation runs only for `pi-custom-provider`, `pi-model-trace`, and `pi-skill`. The regression-guard requirement, the per-package order, and review of each deletion batch limit the damage.

## Migration Plan

Each task group lands independently and leaves `npm run check` and CI green. There is nothing to roll out and no user-visible change except the defect fixes, which ship through normal release intents. Reverting a group restores its tests.

## Open Questions

None block implementation. The recorded behaviours above can be judged later without changing this plan.

[#6557]: https://github.com/earendil-works/pi/issues/6557
[#8814]: https://github.com/earendil-works/pi/issues/8814
[#10025]: https://github.com/earendil-works/pi/issues/10025
[#10228]: https://github.com/earendil-works/pi/issues/10228
[#10267]: https://github.com/earendil-works/pi/issues/10267
[#10704]: https://github.com/earendil-works/pi/issues/10704
[#10705]: https://github.com/earendil-works/pi/issues/10705
[#10724]: https://github.com/earendil-works/pi/issues/10724
[#10982]: https://github.com/earendil-works/pi/issues/10982
[#11011]: https://github.com/earendil-works/pi/issues/11011
[#11219]: https://github.com/earendil-works/pi/issues/11219
[#11287]: https://github.com/earendil-works/pi/issues/11287
[#11336]: https://github.com/earendil-works/pi/issues/11336
[#11452]: https://github.com/earendil-works/pi/issues/11452
[#11472]: https://github.com/earendil-works/pi/issues/11472
[#11518]: https://github.com/earendil-works/pi/issues/11518
[#11673]: https://github.com/earendil-works/pi/issues/11673
[#11706]: https://github.com/earendil-works/pi/issues/11706
