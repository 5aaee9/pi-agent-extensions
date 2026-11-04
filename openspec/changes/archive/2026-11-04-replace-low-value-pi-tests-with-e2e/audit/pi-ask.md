# Test audit: `pi-ask/` (Pi 1.5.0 pinned)

Read-only audit. Nothing in the repository was edited; `git status` shows only the untracked `openspec/changes/isolate-plugin-systems-in-agent-docs/` that predates this work.

## 1. Bottom line

| Verdict   | Cases                                                            | Lines (test bodies, approx.) |
| --------- | ---------------------------------------------------------------- | ---------------------------- |
| KEEP      | 131 (10 already real-host, 121 package logic with no Pi process) | 3,150                        |
| REPLACE   | 30                                                               | 1,020                        |
| DELETE    | 50                                                               | 1,130                        |
| **Total** | **211**                                                          | **5,300**                    |

The owner's claim is half right. 80 of 211 cases (38%) should go. The rest is a large state machine, a parser, and config migration, and many of those tests guard real bugs: 29 KEEP cases were introduced by upstream `fix:` commits. The larger problem is the opposite of too many tests: **only 10 tests touch real Pi, and none of them ever answers a question.** The real-host suite opens a form and presses Escape. Typing, submitting, resume, replay, `/answer`, `/ask-settings`, and remote events have no real-host coverage.

**Real bug found by the audit (verified).** On Pi 1.5.0, `/answer` fails for any user with no Anthropic credentials under the default config. It reports `Error: Error: Provider is not configured: anthropic` and never falls back to the chat model.

- `ModelRegistry.getApiKeyAndHeaders` returns `{ ok: true }` for a provider with no credentials and no `authHeader` requirement (`pi-coding-agent/dist/core/model-registry.js:34-42`). Probe output for `anthropic/claude-haiku-4-5`: `found: true, auth: {ok:true}, configured: false`.
- `selectExtractionModel` treats `auth.ok` as "has auth" (`pi-ask/src/answer-extraction.ts:67`), selects anthropic, and `complete` then throws.
- With `answer.extractionModels: []` the same scenario passes end to end, which isolates the fault. `ModelRegistry.hasConfiguredAuth` exists and returned the right answer in the probe.
- `answer-extraction.test.ts` "selectExtractionModel uses first configured model with auth" passes because its stand-in returns `{ok:false}`, a value the real host does not return in this case. This is the concrete cost of category (d).
- The same auth result appears on both pinned hosts (probed on 1.5.0 and 1.4.0), so this is pi-ask's misreading of the contract rather than a change in 1.5.0. The failure itself was reproduced end to end on 1.5.0 only.
- Not fixed here. The later proposal should carry it, with a release intent.

**Decision the proposal must make.** `openspec/specs/real-environment-testing/spec.md` ("Every test ... SHALL drive that package through the host packages") and `docs/conventions.md` ("Tests") as written condemn all 121 KEEP cases that run no Pi process. Their failure modes are in pi-ask's own reducers and parsers, where a host adds nothing, and replacing them with PTY runs is impractical. This audit follows the brief's KEEP criteria over the spec. The proposal needs to amend the requirement to exempt pure package logic, or the verdicts below conflict with the spec.

## 2. Method: verified vs inferred

**Verified by running**

- `npx vitest run` in `pi-ask/`: 211 passed, 2.27s wall. Real-host files repeated 10 times: 10/10 passed.
- `notifications.test.ts` under a real PTY: passed (vitest workers have piped stdout).
- `~/.pi/agent/pi-ask.json` mtime is Oct 13, so tests did not touch the real agent dir.
- Throwaway real-Pi probes in the scratchpad (`ask/e2e-probe.ts`, `e2e-probe2.ts`, `e2e-probe3.ts`, reusable as a starting point): every "probe" result in section 4 and section 5 comes from a real Pi process with the local model server.
- Packed tarball extracted with no `node_modules`: loads in Pi 1.5.0, and `get_commands` lists all 4 commands.

**Verified by reading installed Pi dist/types/docs**: every Pi behaviour cited with a `dist/` or docs path.

**Inferred**: verdict reasoning about what a test "would catch" comes from reading code. No mutation testing was done. Upstream provenance uses `git log -S'<test name>'` on `/tmp/repos/eko24ive/pi-ask` (the fork base), which gives the first commit containing the name; I did not confirm each test failed before its fix.

**History caveat.** Repo-local history cannot show regressions: nearly all tests arrive in the squashed import `b61ed1c`. Only `740a8a5` and `e3c21cc` add later work here. Citations below are upstream SHAs unless they are one of those two.

**Category note.** The brief's categories have no slot for a redundant test, so I use `DELETE (dup)` where a case is a strict subset of a named other case. A stand-in **host** (fake `pi.on`, fake `ctx.ui.custom`, `TestEventBus`, fake `modelRegistry`) is (d). Stand-in **data** (`getBranch: () => [...]` returning Pi-shaped entries) is package scan logic over an input, so it stays KEEP, with the shape risk flagged in section 5. The letter on a REPLACE row names why the existing test is inadequate, and the `E#` names what replaces it.

## 3. Verdicts by file

`E#` refers to the scenarios in section 4.

### answer-commands.test.ts (1): file becomes empty

| Test                                                   | Verdict     | Reason                                                                  |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------------------- |
| answer commands do not open custom UI outside TUI mode | REPLACE (d) | Hand-built `pi` and `ctx`. Behaviour matters (upstream `d6db94a`). E11. |

### answer-extraction.test.ts (13)

| Test                                                                       | Verdict        | Reason                                                                                                                   |
| -------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| selectExtractionModel uses first configured model with auth                | REPLACE (d)    | Stand-in auth hides the real bug in section 1. E10.                                                                      |
| selectExtractionModel respects the current session model scope             | REPLACE (d)    | Fake registry and scope. E10 scope variant (`--models`).                                                                 |
| selectExtractionModel rejects a fallback outside the current session scope | REPLACE (d)    | Same. E10 scope variant.                                                                                                 |
| selectExtractionModel validates fallback model auth                        | REPLACE (d)    | `{ok:false}` is only real for `authHeader` providers. E10 variant with a keyless `authHeader` provider in `models.json`. |
| extraction context includes the tool and preceding turn                    | REPLACE (a, d) | Partly pins a prompt constant. The wire request in E10 proves more.                                                      |
| extraction business rules flag option spam                                 | DELETE (a)     | Restates the constant max of 4 and its message.                                                                          |
| repairExtractionParams caps options while preserving other                 | KEEP           | Catches silently dropping the "Other" choice when capping.                                                               |
| repairExtractionParams drops generic conversational prompts                | KEEP           | Catches a "How can I help?" form being shown to the user.                                                                |
| tool-call arguments become the extraction candidate                        | KEEP           | Parser: thinking block ignored, args serialized and validated.                                                           |
| tool-call arguments take precedence over text                              | KEEP           | Catches parsing prose when a tool call exists.                                                                           |
| multiple tool calls are rejected                                           | KEEP           | Catches silently using the first of several calls.                                                                       |
| fenced text remains a fallback                                             | KEEP           | Models really do fence JSON.                                                                                             |
| semantic validation issues are returned for retry feedback                 | KEEP           | Catches invalid forms skipping the retry path.                                                                           |

### ask-flow-status.test.ts (4, `describe.each` over 2 hosts)

| Test                                                                              | Verdict | Reason                                                                                                 |
| --------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| reports one blocked root record across redraws and restores status on Escape (×2) | KEEP    | Real Pi 1.5.0 and 1.4.0 under PTY (`e3c21cc`, `740a8a5`). Fails on a `blocked` or OSC contract change. |
| honors PI_PROGRAM_STATUS=0 throughout the real question interaction (×2)          | KEEP    | Real hosts. Catches writes when the user disabled status.                                              |

Verified: legacy `showExtensionCustom` calls `pushExtensionDialog(c)` with no `blocked`, so the 1.4.0 case really runs pi-ask's fallback writer, not Pi's. Both hosts produce the same record shape, so the test output alone cannot show which writer ran; the source check is what establishes this.

### ask-payload-store.test.ts (3)

| Test                                                                      | Verdict | Reason                                                                       |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| branch payload lookup returns the latest valid matching source            | KEEP    | Catches replay opening an older form.                                        |
| branch payload lookup allows freeform only for answer extraction payloads | KEEP    | Validation boundary: tool payloads must not gain freeform.                   |
| branch payload lookup ignores invalid stored payloads                     | KEEP    | Old sessions: drives the "no longer compatible" message rather than a crash. |

### ask-settings-command.test.ts (2): file becomes empty

| Test                                                            | Verdict     | Reason                                                                                                  |
| --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| registers /ask-settings and opens the shared settings overlay   | REPLACE (d) | Fake `ui.custom`. Exact overlay options restate the code. Pins the stale `@eko24ive/pi-ask` header. E7. |
| /ask-settings notifies outside TUI instead of opening custom UI | REPLACE (d) | Fake ctx (upstream `d6db94a`). E11.                                                                     |

### ask-tool.test.ts (6, one block runs for json and rpc)

| Test                                                                                 | Verdict | Reason                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| persists valid payloads and returns pending questions in {json,rpc} mode (×2)        | KEEP    | Real host. Covers tool registration, `prepareArguments`, `appendEntry`, `before_agent_start`, prompt guidelines, and the non-TUI guard. |
| prepares missing and blank labels before the host schema validation                  | KEEP    | Real host. Fails if Pi reorders `prepareArguments` and validation.                                                                      |
| preserves preview fallback and normalizes blank presentation fields                  | KEEP    | Real host, real wire request.                                                                                                           |
| rejects semantic errors without persisting an invalid ask payload                    | KEEP    | Real host. Catches invalid payloads being stored and later reopened.                                                                    |
| lets pi-schema reject missing values and unsupported question types before execution | KEEP    | Real host and pi-schema. `e3c21cc` records an actual `StringEnum` compatibility break in this area.                                     |

### auto-submit.test.ts (3)

| Test                                                         | Verdict           | Reason                                                                   |
| ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| auto submit completes answered submit-tab state when enabled | KEEP              | Multi-condition guard.                                                   |
| auto submit does nothing when disabled                       | KEEP (borderline) | Catches a form closing on everyone by itself; low regression likelihood. |
| auto submit does not trigger when notes exist                | KEEP              | Catches notes being dropped by premature submit.                         |

### autocomplete.test.ts (1): file becomes empty

| Test                                                        | Verdict     | Reason                                                                                                                                                       |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ask autocomplete explicitly triggers on file mention marker | REPLACE (a) | Asserts a constant, yet guards a real silent break (upstream `d6db94a`; pi-tui `editor.js:306` reads `provider.triggerCharacters`). E3 proves the behaviour. |

### config-migrate.test.ts (6)

| Test                                                                   | Verdict           | Reason                                                                                  |
| ---------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| config migration framework accepts the current schema version          | KEEP (borderline) | Catches defaults drifting from the V5 validator, which would mark every config invalid. |
| config migration maps previous-version config files into current shape | KEEP              | User data, v1 to v3 chain.                                                              |
| config migration adds v5 defaults to v4 configs                        | KEEP              | User data; keeps user values.                                                           |
| config migration maps legacy flat keymaps into context keymaps         | DELETE (dup)      | Strict subset of the v3 case above.                                                     |
| config migration framework rejects unsupported future schema versions  | KEEP              | Catches misreading a config from a newer pi-ask.                                        |
| config migration framework rejects unversioned config files            | KEEP              | Same boundary.                                                                          |

### config-store.test.ts (10, one block runs twice)

All real filesystem, real `getAgentDir`.

| Test                                                                                             | Verdict           | Reason                                                                        |
| ------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------- |
| resetAskConfigStore reloads the global store from disk                                           | KEEP              | Regression, upstream `d6db94a`: `/reload` must pick up edits.                 |
| config store writes defaults when file is missing                                                | KEEP (borderline) | First-run file shape.                                                         |
| config store uses defaults when initial config creation fails                                    | KEEP              | Regression `fa89c15`. Uses a subclass stub; could use a real unwritable path. |
| config store writes full normalized config on save                                               | KEEP (borderline) | Partial save must not drop fields.                                            |
| config store reports friendly save failures                                                      | KEEP              | Regression `fa89c15`, real EISDIR.                                            |
| config store leaves broken json unchanged and loads defaults                                     | KEEP              | Regression `fa89c15`: destructive rewrite of user data.                       |
| config store loads migrated config without rewriting                                             | KEEP              | Regression `fa89c15`.                                                         |
| config store falls back only keymaps when configured keymaps are invalid                         | KEEP              | Catches losing all settings over one bad key.                                 |
| config store ignores the retired osc7501 channel {with other channels, as the only channel} (×2) | KEEP              | User-data compatibility, spec'd in `ask-program-status`, `e3c21cc`.           |

### dismiss-guard.test.ts (4): file becomes empty

| Test                                                        | Verdict     | Reason                                                                           |
| ----------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| dirty flow state is false for untouched ask flow            | REPLACE (e) | Trivial wrapper; the behaviour is the Esc flow. E13.                             |
| dirty flow state is true for saved answers or editor drafts | REPLACE (e) | E13.                                                                             |
| confirm dismiss when dirty respects dirty state and config  | REPLACE (e) | E13, with `confirmDismissWhenDirty: false` variant.                              |
| dismiss confirmation is active while pending                | DELETE (a)  | `shouldDiscardAfterConfirmation(x)` is `return x`. The function itself could go. |

### dismiss-notice-behavior.test.ts (1): file becomes empty

| Test                                                                 | Verdict    | Reason                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dismiss notice stays visible on same tab and clears after tab change | DELETE (d) | **Vacuous.** It passes the notice to one render and omits it from the next, so "clears" reflects the test's own arguments. The real logic (`clearFooterNotices`, `controller.ts:476`) never runs. E13 covers it. |

### editor-state.test.ts (8)

| Test                                                          | Verdict      | Reason                                                                  |
| ------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| syncStateToSelection opens input when custom option is active | KEEP         | Auto-open editor logic.                                                 |
| saveEditorDraft stores question note drafts without advancing | DELETE (dup) | Covered by `getEditorDraft reads saved note...` and `state.test`.       |
| submitEditorDraft advances submitted custom answers           | DELETE (dup) | Subset of the next-freeform test.                                       |
| submitted answer can sync directly into next freeform input   | KEEP         | `/answer` freeform chain.                                               |
| syncStateToSelection does not reopen answered freeform input  | KEEP         | Catches trapping the user in an editor.                                 |
| tab navigation can sync from review back into freeform input  | KEEP         | Navigation edge.                                                        |
| submitEditorDraft saves notes without completing the ask flow | KEEP         | Catches Enter in a note submitting the whole form (upstream `b030b90`). |
| getEditorDraft reads saved note and custom text from view     | KEEP         | Catches the wrong draft being shown, then overwritten.                  |

### input.test.ts (12)

These use the real pi-tui `matchesKey`, so they also detect key-parsing changes in the host.

| Test                                                                 | Verdict           | Reason                                                                                                                                                             |
| -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| empty typing mode uses arrows and tab for navigation                 | KEEP              | Regression `5d7ccc8`.                                                                                                                                              |
| non-empty typing mode keeps arrows and tab in editor                 | KEEP              | Regression `5d7ccc8`, `cdea90b`.                                                                                                                                   |
| empty note editing mode uses arrows and tab for navigation           | KEEP (borderline) | Regression `5d7ccc8`. Separate entry point, shared helper.                                                                                                         |
| non-empty note editing mode keeps arrows and tab in editor           | KEEP (borderline) | Regression `5d7ccc8`. Same.                                                                                                                                        |
| ctrl+c dismisses the flow from both navigation and editing modes     | KEEP              | Catches being unable to leave an editor.                                                                                                                           |
| question mark opens ask settings outside non-empty editors           | KEEP              | Catches `?` being swallowed while typing.                                                                                                                          |
| question type shortcut uses configured main keymap                   | KEEP (borderline) | Config reaches the binding, with real ctrl parsing.                                                                                                                |
| note shortcuts use n for option notes and Shift+N for question notes | DELETE (a)        | Pins default keymap constants; shift parsing is covered by the custom-key case.                                                                                    |
| custom configured editor submit shortcut is used at runtime          | KEEP              | Enter-vs-configured-key dispatch.                                                                                                                                  |
| custom editor submit key controls actual editor submission           | REPLACE (d)       | Fake `ui.custom` and TUI. E2.                                                                                                                                      |
| ask flow forwards focus and invalidation to its editor               | DELETE (d, e)     | Monkeypatches `Editor.prototype`; asserts a getter returns what its setter set. Known coverage loss: focus forwarding (cursor/IME), which no scenario here checks. |
| custom configured note shortcuts are used at runtime                 | KEEP              | Custom keys and shift+letter.                                                                                                                                      |

### notifications.test.ts (6)

| Test                                                                      | Verdict     | Reason                                                                                                                                |
| ------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| notification payload uses question label before prompt                    | DELETE (a)  | Constants; label case already asserted by the real-host status test.                                                                  |
| notification payload falls back to prompt and compacts whitespace         | KEEP        | Newlines reaching terminal sequences and command env.                                                                                 |
| disabled notifications are skipped                                        | REPLACE (e) | Trivial guard and return shape; the real effect is a bell in a terminal. E14.                                                         |
| new configurations enable only the bell                                   | DELETE (a)  | Asserts a default constant. `config store writes defaults` covers the file.                                                           |
| terminal notifications do not write escape sequences to redirected stdout | DELETE (e)  | Environment-coupled (asserts `isTTY` false first). The form only runs in TUI mode, so the branch is close to unreachable in practice. |
| command notification receives env and swallows failures                   | KEEP        | Real child processes; a failing user command must not break the form.                                                                 |

### pending-ask.test.ts (11)

Regression source for all except where noted: upstream `4de596a fix: restore pending asks after resume`. The scan cases use stand-in data; see the SILENT flag in section 5.

| Test                                                                                     | Verdict     | Reason                                                                |
| ---------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| pending ask scan selects the newest unresolved ask_user_question call                    | KEEP        | Catches reopening a resolved form. Name not found upstream (renamed). |
| pending ask scan uses the latest unresolved call within one assistant message            | KEEP        | Multi-call message ordering.                                          |
| pending ask scan ignores tool-shaped content from failed assistant responses             | KEEP        | Catches reopening a call that never executed.                         |
| pending ask scan prefers its valid persisted payload                                     | KEEP        | Normalized params over raw model args.                                |
| pending ask scan validates recorded arguments as payload fallback                        | KEEP        | Version mismatch and invalid fallback branches.                       |
| pending ask scan skips a newer invalid call for an older valid call                      | KEEP        | Scan edge.                                                            |
| pending ask scan ignores tool results and persisted dismissals                           | KEEP        | Catches a form reopening on every start.                              |
| pending dismissal does not hide the payload from manual replay                           | KEEP        | Interaction between two features.                                     |
| pending ask resume scans only startup, resume, and fork TUI events                       | REPLACE (d) | Fake `pi.on` and modes. E6.                                           |
| resumed submit persists dismissal, delivers an answer, and emits remote lifecycle events | REPLACE (d) | Fake `pi`, `ctx`, TUI, and bus. E4 and E9.                            |
| resumed cancel persists dismissal and does not reopen on a second resume                 | REPLACE (d) | E5.                                                                   |

### program-status.test.ts (9)

| Test                                                                                | Verdict     | Reason                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| program status records match Pi's root record format                                | DELETE (a)  | Compares to a hand-written copy, not Pi. The real legacy PTY test asserts actual fields.                                    |
| program status messages drop control characters and stay within 2048 bytes          | KEEP        | Escaping: model-supplied text reaches an OSC sequence; UTF-8 boundary truncation.                                           |
| resting status follows Pi's run results                                             | REPLACE (d) | Fake `pi.on`. E17. Logic is non-trivial: if E17 proves too costly for a sub-case, keep it driving tracker methods directly. |
| resting status ignores non-assistant messages and resets on aborts and new sessions | REPLACE (d) | E17.                                                                                                                        |
| only a manual compaction outside a run marks the session done                       | REPLACE (d) | E17 (compaction variant, not probed).                                                                                       |
| fallback reporting stays silent without a TTY or with PI_PROGRAM_STATUS=0           | DELETE (e)  | `=0` is covered by the real legacy test; no-TTY cannot occur in TUI mode.                                                   |
| fallback restores working with the session name during a run, once                  | REPLACE (d) | Fake ctx. E17 with a named session.                                                                                         |
| fallback restores the tracked resting status when idle                              | REPLACE (d) | E17 (`done` probed).                                                                                                        |
| a done restore without a session name carries no message                            | DELETE (e)  | Trivial; subsumed by E17.                                                                                                   |

### question-view-model.test.ts (4)

| Test                                                            | Verdict    | Reason                                           |
| --------------------------------------------------------------- | ---------- | ------------------------------------------------ |
| question view model marks active custom option as inline editor | DELETE (e) | Field pin plus a placeholder constant.           |
| question view model marks multi custom answer as checked        | KEEP       | Regression `780aac2`: wrong checked state shown. |
| question view model exposes saved question notes                | DELETE (e) | Pass-through field.                              |
| preview view model selects stacked vs custom layouts            | DELETE (e) | Enum pin; E15 covers preview behaviour.          |

### remote-ask.test.ts (7)

| Test                                                                   | Verdict           | Reason                                                                         |
| ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| remote answer response validates and serializes explicit option values | KEEP              | Public event contract parser.                                                  |
| remote answer response replaces stale UI answers                       | KEEP              | Semantics a bridge relies on.                                                  |
| remote answer response rejects guessed or unknown option values        | KEEP              | Input validation at a public boundary.                                         |
| remote cancel completes the flow as cancelled                          | DELETE (e)        | Three-line branch.                                                             |
| started event questions are cloned                                     | KEEP (borderline) | Catches a bridge mutating the live form; the clone is pi-ask's, not the bus's. |
| remote runtime disposes active flows and submit listener               | REPLACE (d)       | `TestEventBus`. Real leak fixed in upstream `d6db94a`. E9 dispose variant.     |
| remote submit resolves an active ask flow and emits lifecycle events   | REPLACE (d)       | Fake bus and ctx. E9.                                                          |

### render-frame.test.ts (7)

| Test                                                         | Verdict    | Reason                                                                    |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------- |
| wide header keeps all tabs and framing arrows on the tab row | DELETE (e) | Exact string pin (upstream "test: tighten render assertions").            |
| narrow tab strip keeps active middle tab visible             | KEEP       | `getVisibleTabRange` windowing; the active tab vanishing is user-visible. |
| narrow tab strip keeps submit tab visible when active        | KEEP       | Same; the user cannot find Review.                                        |
| tab strip avoids truncation at narrow boundary widths        | KEEP       | Regression `3515098`, off-by-one at widths 28 to 32.                      |
| footer hints wrap into exact lines on narrow screens         | DELETE (e) | Exact copy pin.                                                           |
| footer keeps earlier hint chunk on the first wrapped line    | DELETE (e) | Exact copy pin.                                                           |
| footer hints can be hidden without affecting frame rendering | DELETE (e) | One-branch setting and a border pin.                                      |

### render-helpers.test.ts (5)

| Test                                                                | Verdict     | Reason                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderEditorBlock strips editor borders                             | REPLACE (d) | Mock lines (`┌──┐`) are not what the real Editor draws (`─` rows and `↑ n` scroll rows, pi-tui `editor.js:390-394`), so it says nothing about the actual contract. E2 asserts on the real screen. |
| renderEditorBlock shows a muted placeholder when empty              | DELETE (e)  | Constant through a mock.                                                                                                                                                                          |
| renderEditorBlock reapplies background after editor reset sequences | KEEP        | Regression `bc92712`: highlight drops mid-line after a reset.                                                                                                                                     |
| editing footers do not advertise tab navigation                     | DELETE (e)  | Exact copy pin, despite coming from fix `cdea90b`; the behaviour itself is tested in `input.test.ts`.                                                                                             |
| editing footers use configured key labels                           | KEEP        | Catches the footer naming keys that do not work.                                                                                                                                                  |

### render-question.test.ts (9): file becomes empty

All use mock editor and theme.

| Test                                                                                  | Verdict     | Reason                                                              |
| ------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| custom option stays labeled before selection                                          | DELETE (e)  | Copy pin.                                                           |
| standard options show recommendation metadata without changing answers                | DELETE (e)  | Color and copy pin; non-selection is covered in `state.test`.       |
| selected custom option keeps its label and renders editor below                       | REPLACE (d) | Fix `bc92712`, but through a mock. E3 shows it on the real screen.  |
| open question note renders inline label and editor                                    | DELETE (e)  | Spacing pin.                                                        |
| open option note renders flush below the option                                       | DELETE (e)  | Spacing pin.                                                        |
| selected multiline custom option renders full editor block                            | REPLACE (d) | Fix `bc92712`; the mock cannot show real multi-line behaviour. E19. |
| freeform-only question renders label without numbering or pointer and separates input | DELETE (e)  | Layout pin; E10 opens a freeform form.                              |
| preview questions show custom and recommended options                                 | REPLACE (d) | Preview is a headline feature with no real-host interaction. E15.   |
| preview custom option reuses the normal inline editor                                 | REPLACE (d) | E15.                                                                |

### render-submit.test.ts (8)

| Test                                                                                    | Verdict    | Reason                                   |
| --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| submit screen renders the compact action labels without extra prompt copy               | DELETE (e) | Exact string pin.                        |
| submit screen keeps review and actions grouped side by side on wide screens             | DELETE (e) | Exact layout pin.                        |
| submit screen stacks review above actions on narrow screens                             | DELETE (e) | Exact layout pin.                        |
| submit screen can show a review shortcut hint below the actions                         | DELETE (e) | Wrap pin.                                |
| submit screen shows notes only for answered questions in submit mode                    | KEEP       | The review must match what is submitted. |
| submit screen shows all notes when elaborate action is selected                         | KEEP       | Same, elaborate mode.                    |
| submit screen renders multi-select option notes under their related answers             | DELETE (e) | Ordering pin.                            |
| submit action column keeps all three actions on consecutive rows at the wide breakpoint | DELETE (e) | Exact breakpoint pin.                    |

### result.test.ts (18)

These strings are the tool result the model reads, so wording here is a behavioural contract, not decoration.

| Test                                                                       | Verdict           | Reason                                                             |
| -------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| summarizeResult formats selected answers                                   | DELETE (dup)      | Subset of the unanswered case; E1 covers the wire.                 |
| submitted results surface unanswered questions without serializing answers | KEEP              | Regression `ce230db`.                                              |
| submitted results surface every question when all are unanswered           | KEEP              | Regression `ce230db`.                                              |
| single questions presented as multi preserve requested type in results     | KEEP              | Model must learn the presentation changed.                         |
| presentation override summary uses one compact note                        | KEEP (borderline) | Catches a repeated note.                                           |
| summaries include custom text answers                                      | KEEP (borderline) | Typed answers reaching the model.                                  |
| multi-select summaries include selected options and custom text            | KEEP              | Regression `8d8e7b6`.                                              |
| summaries and result text include question and selected option notes       | KEEP              | Notes reaching the model.                                          |
| unselected option notes are omitted from the submitted result              | KEEP              | Catches leaking notes on unchosen options.                         |
| question-note-only results still render note content                       | KEEP              | Edge branch.                                                       |
| elaborate results include unselected notes in summary and render output    | KEEP              | Continuation contract. Could drop the exact instruction string.    |
| elaborate results keep committed answers alongside elaboration context     | KEEP              | Continuation contract.                                             |
| elaboration summary includes custom answers in note context                | KEEP              | Regression `85962d9`.                                              |
| elaboration summary includes answered custom text even without notes       | KEEP              | Regression `85962d9`.                                              |
| elaborate continuation preserves unrelated committed answers               | KEEP              | Catches re-asking answered questions.                              |
| elaboration preserves recommendation metadata                              | KEEP (borderline) | Catches losing recommendations on re-ask.                          |
| invalid tool payload result is attributed to the tool call                 | DELETE (a)        | One branch returning a constant.                                   |
| cancelled result hides unanswered questions                                | KEEP              | Regression `ce230db`: the model must see a cancel, not unanswered. |

### review-shortcuts.test.ts (3)

| Test                                                                    | Verdict    | Reason                                         |
| ----------------------------------------------------------------------- | ---------- | ---------------------------------------------- |
| review shortcut double press requires the same digit twice              | KEEP       | Catches one keypress submitting or cancelling. |
| review shortcut double press switches pending action when digit changes | KEEP       | Same state machine.                            |
| review shortcut hint reflects pending confirmation state                | DELETE (a) | Hint strings.                                  |

### settings-list.test.ts (9)

| Test                                                                       | Verdict           | Reason                                                                                                        |
| -------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| settings list renders behaviour settings and config path                   | DELETE (e)        | Copy pin. Also pins the stale `@eko24ive/pi-ask` header and contains vacuous checks such as `includes("on")`. |
| settings list stays within narrow render width                             | KEEP              | Property test with real `visibleWidth`.                                                                       |
| settings list saves behaviour changes immediately without success feedback | REPLACE (d)       | Fake `onSave`. E7 proves the file is written.                                                                 |
| settings list shows save failures and reverts the toggle                   | KEEP              | Read-only config: UI must not show a false state.                                                             |
| settings list renders load warnings                                        | DELETE (e)        | Display pass-through.                                                                                         |
| settings list clears load warnings after successful save                   | DELETE (e)        | Trivial.                                                                                                      |
| settings list uses configured navigation and close keys                    | KEEP (borderline) | Config reaches the modal.                                                                                     |
| settings list resets config to defaults after double press                 | KEEP              | Guard on a destructive action.                                                                                |
| settings list closes with configured keys and dispose idempotently         | DELETE (e)        | Pi's own `close` guards double calls (`interactive-mode.js`, `if (closed) return`).                           |

### state.test.ts (38)

| Test                                                                                 | Verdict           | Reason                                                    |
| ------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------- |
| normalize defaults via initial state                                                 | DELETE (a)        | Restates defaults.                                        |
| answer freeform questions render only the custom input option                        | KEEP              | Option list branch.                                       |
| freeform questions are rejected unless explicitly allowed                            | KEEP              | Tool callers must not get freeform.                       |
| freeform questions cannot mix normal options                                         | KEEP              | Validation.                                               |
| preview questions keep their type and option previews                                | DELETE (e)        | Pass-through.                                             |
| createInitialState rejects duplicate question ids                                    | DELETE (dup)      | Asserted on the real host in `ask-tool.test.ts`.          |
| createInitialState rejects duplicate option values within one question               | KEEP              | Not covered elsewhere; ambiguous answers.                 |
| preview questions require preview text for every option                              | DELETE (dup)      | Asserted on the real host in `ask-tool.test.ts`.          |
| normalize trims ids, prompts, and option text                                        | KEEP              | Model payloads carry whitespace; id lookups depend on it. |
| normalize treats blank optional presentation text as absent                          | DELETE (dup)      | Mostly asserted on the real host (fix `852e625`).         |
| normalization preserves any number of recommended options without selecting them     | KEEP              | Catches a recommendation pre-answering.                   |
| single-select number shortcut stores answer and advances to next tab                 | KEEP (borderline) | Happy path E1 also covers.                                |
| multi-select space toggles current option and enter advances to submit               | KEEP              | Transition.                                               |
| single-select space toggles the active option without advancing                      | KEEP              | Transition.                                               |
| presentSingleAsMulti handles requested single questions as multi-select              | KEEP              | Setting changes the state machine.                        |
| question type hotkey toggles single and multi while preserving requested type        | KEEP              | Transition.                                               |
| question type hotkey toggles preview questions with multi only                       | KEEP              | Branch.                                                   |
| question type hotkey requires confirmation before clearing multi answers             | KEEP              | Data-loss guard.                                          |
| confirmed multi-to-single type change preserves custom text and notes                | KEEP              | Data-loss edge.                                           |
| submit can complete even when some questions are unanswered                          | KEEP              | Documented contract.                                      |
| submit tab can complete in elaborate mode                                            | KEEP              | Transition.                                               |
| selecting other enters input mode and custom submit stores typed answer              | KEEP (borderline) | Happy path E2 also covers.                                |
| escape saves typed custom answer without advancing                                   | KEEP              | Draft preservation.                                       |
| multi-select keeps existing selections when leaving custom input empty               | KEEP              | Regression `8d8e7b6`.                                     |
| multi-select keeps existing selections and stays on tab when submitting custom text  | KEEP              | Regression `780aac2`.                                     |
| empty custom draft clears the stored answer but preserves notes                      | KEEP              | Edge.                                                     |
| question note can be saved without selecting an answer and is submitted              | KEEP              | Edge.                                                     |
| option notes can exist before selection but only selected option notes are submitted | KEEP              | Edge.                                                     |
| deselecting an option keeps its note in state but omits it from submission           | KEEP              | Edge.                                                     |
| multi-select toggles saved custom text selection with space or number shortcuts      | KEEP              | Regression `780aac2`.                                     |
| multi-select keeps custom text when toggling additional options                      | KEEP              | Regression `8d8e7b6`.                                     |
| preview questions can store selected option notes for submission                     | DELETE (dup)      | Same path as the option-note cases.                       |
| preview questions support custom answers                                             | DELETE (dup)      | Same path as the custom-answer case.                      |
| tab navigation wraps including submit tab                                            | KEEP              | Modular arithmetic.                                       |
| tab navigation works with a single question                                          | DELETE (dup)      | Same arithmetic.                                          |
| submit tab number shortcuts trigger matching review actions                          | KEEP              | Action mapping and out-of-range digit.                    |
| escape cancels from main flow but only exits input and note modes when editing       | KEEP              | Catches Esc in an editor discarding the form.             |
| dismissFlow cancels the tool even from editing modes                                 | KEEP              | Inverse of the above.                                     |

### text.test.ts (3)

| Test                                           | Verdict | Reason                                                                                                         |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| wrapText wraps prose                           | KEEP    | Own wrapping implementation.                                                                                   |
| wrapText preserves blank lines and indentation | KEEP    | Same.                                                                                                          |
| wrapText breaks long words                     | KEEP    | Same. If `wrapText` is replaced by pi-tui's `wrapTextWithAnsi` (already imported elsewhere), delete all three. |

### Helpers (not test cases)

`test/host-plane.ts`, `test/tui-plane.ts`: keep, they are the base for all E# scenarios. `startAskTui` accepts one payload and fixed args, so it needs to accept extra args, config, and restart on the same session. Scrub provider credentials from the inherited `process.env`: it is copied into the child, so a developer's `ANTHROPIC_API_KEY` would change the `/answer` result.

### Borderline KEEP

18 cases are marked or belong here if the owner wants a harder cut: auto-submit disabled; migrate current version; config-store defaults and normalized save; input empty and non-empty note mode, type shortcut; payload latest source; result override note, custom text, recommendation metadata; state number shortcut and selecting other; settings configured keys; remote cloned questions; `text.test.ts` (3, conditional on replacing `wrapText`).

## 4. E2E scenarios to build

All run a real Pi process with the local model server from `host-plane.ts`. RPC `custom()` is a no-op, so anything that shows a form needs a PTY. Timings are from probes on this machine; the cost is low, so the suite can afford these.

| ID  | Scenario                                                                                                                                                                                     | Replaces                                                    | Probe result                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| E1  | PTY: answer with a digit, Enter on Review; assert `toolResult.details.answers` and next model request                                                                                        | adds the missing happy path                                 | PASS, 456ms                                                                                             |
| E2  | PTY: `editor.submit: ["ctrl+k"]`; type, Enter does not submit, ctrl+k does; assert `customText` and no border glyphs on screen                                                               | input custom submit key, render-helpers borders             | PASS, 711ms (border assert not probed)                                                                  |
| E3  | PTY: type `@probe` in the form editor; file suggestion appears                                                                                                                               | autocomplete, render-question selected custom               | PASS, 1.3s                                                                                              |
| E4  | PTY: SIGKILL with form open, restart on the same session, form reopens, submit; assert `ask:pending-dismissed` and answer delivered to the model                                             | pending-ask resumed submit                                  | PASS, 1.2s                                                                                              |
| E5  | PTY: as E4, Esc on resume, third start does not reopen                                                                                                                                       | pending-ask resumed cancel                                  | PASS, 2.3s                                                                                              |
| E6  | Resume gating: `--mode rpc` on a pending session does not reopen; TUI `/new` and `/reload` do not                                                                                            | pending-ask scan gating                                     | RPC PASS; `/new`, `/reload` not probed                                                                  |
| E7  | PTY: `/ask-settings`, Space, assert file written, Esc                                                                                                                                        | settings command, settings-list save                        | PASS, 1.2s                                                                                              |
| E8  | PTY: `/ask:replay` after a cancel, submit, answer reaches the model                                                                                                                          | adds coverage                                               | PASS, 1.2s                                                                                              |
| E9  | PTY with a second `-e` test extension answering over real `pi.events`; variant: submit after `/new` reaches no disposed flow                                                                 | remote submit, remote dispose, pending-ask lifecycle events | Submit PASS, 406ms; dispose not probed                                                                  |
| E10 | PTY: `/answer` through real `modelRegistry.complete`, chat-model-only credentials; assert extraction request and delivered answer; variants: `--models` scope, keyless `authHeader` provider | 4 selectExtractionModel tests, extraction context           | **FAILS today on default config: the section 1 bug.** PASS with `extractionModels: []`                  |
| E11 | RPC: `/answer`, `/answer:again`, `/ask:replay`, `/ask-settings` each emit a `notify` error and no model request                                                                              | answer-commands, settings notify                            | PASS, 1.0s                                                                                              |
| E12 | Number unused                                                                                                                                                                                |                                                             |                                                                                                         |
| E13 | PTY: answer, Esc shows notice, Esc again cancels; variant with `confirmDismissWhenDirty: false`; notice clears on tab change                                                                 | dismiss-guard (3), dismiss-notice                           | Notice and cancel PASS, 796ms; variants not probed                                                      |
| E14 | PTY: bell count with notifications on vs `enabled: false`                                                                                                                                    | notifications disabled                                      | PASS: 79 vs 78 raw BEL bytes. Pi's OSC terminators are also BEL, so strip OSC first or assert the delta |
| E15 | PTY: preview question at 120 cols: preview text, `(recommended)`, Down changes preview, custom option hides the pane                                                                         | render-question preview (2)                                 | First three PASS, 516ms; custom not probed                                                              |
| E16 | PTY: 12, 20, 30 cols with CJK and emoji labels and typed input; process stays alive                                                                                                          | adds coverage                                               | PASS, no crash, 1.8s each. Liveness only, no layout check                                               |
| E17 | PTY on legacy 1.4.0: `/ask:replay` while idle, Esc; assert restored `done`; variants: `error` (server 500), aborted, manual compaction, named session                                        | program-status tracker and restore (5)                      | `["blocked","done"]` PASS, 1.5s; variants not probed                                                    |
| E18 | Pack the tarball, extract with no `node_modules`, load in Pi; `pi install` variant asserting the bundled skill loads                                                                         | adds packaged-install proof                                 | `-e` load PASS, 4 commands listed; `pi install` and skills not probed                                   |
| E19 | PTY: multi-line custom answer shown on separate rows                                                                                                                                         | render-question multiline                                   | Not probed                                                                                              |

Not scenario-worthy beyond a one-time probe: corrupt config shows a notice and leaves the file unchanged (PASS, 553ms), already covered by `config-store` unit tests.

## 5. Host contracts

"Real-host today" means a committed test that drives real Pi. SILENT = no error, and the user just loses behaviour. Probe coverage is not committed coverage.

| #   | Contract                                                                                                                                                                           | Site                                                                                                                 | Real-host today                                                             | If Pi changes it                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `registerTool` name, `parameters`, `prepareArguments`, `promptGuidelines`                                                                                                          | `src/ask-tool.ts:21-34`                                                                                              | Yes, `ask-tool.test.ts`                                                     | Visible, or caught by those tests. `promptSnippet` is unasserted: SILENT, low impact.                                                                                                                                                                            |
| 2   | Tool `execute(toolCallId, params, signal, onUpdate, ctx)`                                                                                                                          | `src/ask-tool.ts:30`                                                                                                 | Yes (`sourceEntryId` asserted)                                              | Visible crash.                                                                                                                                                                                                                                                   |
| 3   | `renderCall` / `renderResult` signatures                                                                                                                                           | `src/ask-tool.ts:32-33`, `src/ask-tool-helpers.ts:75-105`                                                            | **No**                                                                      | **SILENT.** Pi catches renderer errors and falls back to default text (`tool-execution.js:238,260`).                                                                                                                                                             |
| 4   | `ctx.mode` values (`ExtensionMode = "tui"\|"rpc"\|"json"\|"print"`, `types.d.ts:231`)                                                                                              | `ask-tool.ts:58`, `controller.ts:105`, `answer-commands.ts:68,222`, `show-settings.ts:6`, `resume-pending-ask.ts:26` | Tool: yes. Commands: no                                                     | Rename of `"tui"`: commands show a visible error, but **the tool quietly returns cancelled to the model: SILENT for the user.** PTY tests catch it. New modes are safe.                                                                                          |
| 5   | `ctx.ui.custom(factory)` args, `done`, RPC no-op (#10724: docs `rpc-extension-ui.md:16`, `rpc-mode.js:152`, `runner.js:147`)                                                       | `controller.ts:115`, `show-settings.ts:12`, `answer-commands.ts:150`                                                 | Form: yes. Overlay and loader: no                                           | pi-ask is unaffected by the no-op only because every path guards on `ctx.mode`. Remove a guard and `undefined` becomes a crash in `successfulResponse` or `"cancelled" in undefined` (inferred).                                                                 |
| 6   | `custom` option `blocked`; detection through the getter trap                                                                                                                       | `controller.ts:140-145`                                                                                              | Yes, both hosts                                                             | **SILENT; the PTY test is the only guard.** Works because Pi reads `options?.blocked` before first render and passes options by reference (`interactive-mode.js`, `runner.js:366`). Read lazily after render: double report. Read and ignored: no status at all. |
| 7   | OSC 7501 root format, `PI_PROGRAM_STATUS`                                                                                                                                          | `program-status.ts:20-33,122`                                                                                        | Yes on 1.4.0                                                                | Fallback only: a format drift means a SILENT wrong terminal status on old hosts.                                                                                                                                                                                 |
| 8   | Events `session_start`, `agent_start`, `message_end`, `agent_settled`, `session_compact` and fields `aborted`, `stopReason`, `errorMessage`, `reason`                              | `program-status.ts:82-97`                                                                                            | **No** (fake `pi.on`)                                                       | **SILENT.** A renamed event just never fires, and the tracker stays `idle`. Fallback hosts only. `agent_settled` verified in both 1.4.0 and 1.5.0. E17.                                                                                                          |
| 9   | `before_agent_start` returning `systemPrompt`                                                                                                                                      | `src/index.ts:24`                                                                                                    | Yes (request body asserted)                                                 | SILENT in product; caught by the test.                                                                                                                                                                                                                           |
| 10  | `session_start` reasons, and `ui.custom` working during it (`interactive-mode.js:723` starts the UI first)                                                                         | `resume-pending-ask.ts:25`                                                                                           | **No**                                                                      | **SILENT: forms stop reopening.** E4.                                                                                                                                                                                                                            |
| 11  | `sessionManager.getBranch()` and `SessionEntry` shape: `type`, `message.role`, `stopReason === "toolUse"`, `toolCall` parts, custom entries; `stopReason === "stop"` for `/answer` | `pending-ask.ts:27,59-82`, `ask-payload-store.ts:36,57`, `answer-commands.ts:294-304`                                | Only `custom` entries, by reading the file                                  | **SILENT.** All 11 scan cases use hand-written entries, so they stay green after a shape change. Resume and replay would report nothing to do. E4, E8.                                                                                                           |
| 12  | Pi not synthesizing tool results for orphaned calls on session load                                                                                                                | `pending-ask.ts:44-56`                                                                                               | **No**                                                                      | **SILENT: resume never fires.** Verified today: at SIGKILL the session has the assistant message and `ask:payload`, no toolResult. E4.                                                                                                                           |
| 13  | `pi.appendEntry`                                                                                                                                                                   | `ask-payload-store.ts:24`, `pending-ask.ts:21`                                                                       | Payload: yes. Dismissal: no                                                 | Missing dismissal: form reopens every start, visible.                                                                                                                                                                                                            |
| 14  | `pi.sendUserMessage`, `deliverAs: "followUp"`, `ctx.isIdle()`                                                                                                                      | `resume-pending-ask.ts:83`, `answer-commands.ts:288`                                                                 | **No**                                                                      | **SILENT: answer dropped after the user submitted.** E4, E8.                                                                                                                                                                                                     |
| 15  | `ctx.ui.setWorkingVisible`                                                                                                                                                         | `ask-tool.ts:61,68`, `resume-pending-ask.ts:61,73`, `answer-commands.ts:273,277`                                     | No assertion                                                                | SILENT and cosmetic; a removal is a visible crash.                                                                                                                                                                                                               |
| 16  | `ctx.ui.notify`                                                                                                                                                                    | many, `answer-commands.ts`, `resume-pending-ask.ts`                                                                  | No                                                                          | Visible.                                                                                                                                                                                                                                                         |
| 17  | `pi.events` `on`/`emit`                                                                                                                                                            | `index.ts:27`, `remote-ask.ts:100,160,179,205`                                                                       | **No** (`TestEventBus`)                                                     | **SILENT for bridges.** E9.                                                                                                                                                                                                                                      |
| 18  | `session_shutdown`                                                                                                                                                                 | `index.ts:28`                                                                                                        | **No**                                                                      | **SILENT listener leak;** this was a real upstream bug (`d6db94a`). E9.                                                                                                                                                                                          |
| 19  | `registerCommand`                                                                                                                                                                  | `ask-settings-command.ts:5`, `answer-commands.ts:33,38,50`                                                           | Load only: `test:e2e` requires a successful `get_commands`, not these names | Handler signature change: visible when run. Handlers are never run on a real host today. E7, E8, E11.                                                                                                                                                            |
| 20  | `modelRegistry.find`, `getApiKeyAndHeaders`, `ctx.scopedModels`, `modelsAreEqual`                                                                                                  | `answer-extraction.ts:63-100`                                                                                        | **No**                                                                      | **Already broken: see section 1.** `ok: true` does not mean credentials exist. E10.                                                                                                                                                                              |
| 21  | `modelRegistry.complete` with `signal`; `stopReason` handling                                                                                                                      | `answer-commands.ts:168`, `answer-extraction.ts:173-186`                                                             | **No**                                                                      | Visible error. Timeout mapping relies on `stopReason: "aborted"`: SILENT wrong message if changed. `extractAskParams` (retry, timeout, abort) has **no test of any kind**.                                                                                       |
| 22  | `BorderedLoader` (`signal`, `onAbort`)                                                                                                                                             | `answer-commands.ts:159-174`                                                                                         | Export only, via load                                                       | Value import: removal fails the extension at load, visible and caught by `test:e2e`. `onAbort` change: Esc cannot cancel extraction.                                                                                                                             |
| 23  | pi-tui `Editor`: constructor, `setAutocompleteProvider`, `onSubmit`, `disableSubmit`, `getText`, `setText`, `handleInput`, `render`, `focused`, `invalidate`                       | `controller.ts:189-231,590-608`, `render-question.ts:211`                                                            | Constructed and rendered only; **never typed into**                         | `disableSubmit` or `onSubmit` drift: **SILENT, Enter submits or does nothing.** `render` format drift: SILENT garbling, since pi-ask strips the Editor's borders from its output. E2.                                                                            |
| 24  | `CombinedAutocompleteProvider`, `triggerCharacters` (`pi-tui editor.js:306`)                                                                                                       | `autocomplete.ts:15`                                                                                                 | **No** (constant asserted)                                                  | **SILENT: `@` mentions stop.** E3.                                                                                                                                                                                                                               |
| 25  | `matchesKey` and key parsing                                                                                                                                                       | `input.ts:113`, `keymaps.ts:194`                                                                                     | Real pi-tui in `input.test.ts`                                              | Caught for legacy sequences. Kitty-protocol encodings are untested.                                                                                                                                                                                              |
| 26  | `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`, `Text`                                                                                                                      | `render-*.ts`, `settings-list.ts`, `text.ts`, `ask-tool-helpers.ts:87`                                               | Real in unit tests                                                          | Layout only.                                                                                                                                                                                                                                                     |
| 27  | Theme tokens (`selectedBg`, `accent`, `dim`, `error`, `muted`, `success`, `syntaxString`, `text`, `toolTitle`, `warning`)                                                          | `src/ui/*`                                                                                                           | Partial: only what the PTY form renders                                     | Visible crash: `theme.js:215` throws `Unknown theme color`. All render tests stub the theme, so they cannot detect this.                                                                                                                                         |
| 28  | `getAgentDir`, `PI_CODING_AGENT_DIR`                                                                                                                                               | `config/store.ts:156`                                                                                                | Yes                                                                         | Config silently read from elsewhere; caught.                                                                                                                                                                                                                     |
| 29  | `typebox` and `typebox/value`, `typebox/compile` supplied by Pi's loader aliases (`loader.js:42-44`)                                                                               | `config/schema.ts:1-2`, `schema.ts:1`, `pending-ask.ts`, `ask-payload-store.ts`, `answer-extraction.ts`              | **No.** All tests resolve the workspace's own typebox                       | Visible load failure for **installed users only**: checkout tests and `test:e2e` would stay green. Probed OK from a bare tarball. E18.                                                                                                                           |
| 30  | `pi.skills` manifest                                                                                                                                                               | `package.json`                                                                                                       | **No.** Host plane and `test:e2e` pass `--no-skills`                        | **SILENT: skill not loaded.** E18.                                                                                                                                                                                                                               |

## 6. Totals

| Verdict | Cases | Lines  |
| ------- | ----- | ------ |
| KEEP    | 131   | ~3,150 |
| REPLACE | 30    | ~1,020 |
| DELETE  | 50    | ~1,130 |

Lines are test-block ranges, excluding each file's imports and helpers, so actual removal is higher.

**Files that become empty (6):** `answer-commands`, `ask-settings-command`, `autocomplete`, `dismiss-guard`, `dismiss-notice-behavior`, `render-question`. With headers and helpers, that is 636 lines.

**Left thin:** `question-view-model` (1 case), `program-status` (1), `review-shortcuts` (2), `render-helpers` (2).

| File | K | R | D | | File | K | R | D |
| ---- | - | - | - | | ---- | - | - | - |
| answer-commands | 0 | 1 | 0 | | notifications | 2 | 1 | 3 |
| answer-extraction | 7 | 5 | 1 | | pending-ask | 8 | 3 | 0 |
| ask-flow-status | 4 | 0 | 0 | | program-status | 1 | 5 | 3 |
| ask-payload-store | 3 | 0 | 0 | | question-view-model | 1 | 0 | 3 |
| ask-settings-command | 0 | 2 | 0 | | remote-ask | 4 | 2 | 1 |
| ask-tool | 6 | 0 | 0 | | render-frame | 3 | 0 | 4 |
| auto-submit | 3 | 0 | 0 | | render-helpers | 2 | 1 | 2 |
| autocomplete | 0 | 1 | 0 | | render-question | 0 | 4 | 5 |
| config-migrate | 5 | 0 | 1 | | render-submit | 2 | 0 | 6 |
| config-store | 10 | 0 | 0 | | result | 16 | 0 | 2 |
| dismiss-guard | 0 | 3 | 1 | | review-shortcuts | 2 | 0 | 1 |
| dismiss-notice-behavior | 0 | 0 | 1 | | settings-list | 4 | 1 | 4 |
| editor-state | 6 | 0 | 2 | | state | 30 | 0 | 8 |
| input | 9 | 1 | 2 | | text | 3 | 0 | 0 |

**KEEP cases introduced by upstream `fix:` commits (29):** `fa89c15` config-store (4); `d6db94a` config-store reset (1); `5d7ccc8` input (4); `4de596a` pending-ask scan (7, an eighth appears renamed); `780aac2` state (2) and view model (1); `8d8e7b6` state (2) and result (1); `ce230db` result (3); `85962d9` result (2); `3515098` render-frame (1); `bc92712` render-helpers (1). Separately, 12 KEEP cases come from this repo's `e3c21cc` and `740a8a5`: the 10 real-host cases and 2 osc7501 cases.

## 7. Flaky, slow, or TTY-dependent tests

No test failed across all runs. Nothing is meaningfully slow: the whole suite takes 2.27s.

- **`ask-flow-status` (4):** 400 to 520ms each, passed 10/10. Allocates its own PTY, so it needs no real TTY on the host, but it does need the `node-pty` native module (`1.2.0-beta.15`), a CI risk on new platforms and Node versions.
- **`ask-tool`:** `expect(run.stderr).toBe("")` fails on any new Pi or Node warning. Useful canary, but expect noise on host bumps.
- **`notifications` "redirected stdout":** asserts `process.stdout.isTTY` is false before testing anything. Passes under a real PTY because vitest workers pipe stdout (verified). Would fail under any runner that inherits a TTY (inferred). Already marked DELETE.
- **`ask-settings-command` and `config-store` reset test:** mutate `process.env.PI_CODING_AGENT_DIR` without `try/finally`, so a failure leaks into later tests in that worker. `unstubEnvs` does not cover direct mutation.
- **`input`, `remote-ask`, `pending-ask`, `settings-list`:** wait a single `setImmediate` for async work. Stable today, but ordering-dependent.

## 8. Other findings

- **Stale identity.** The settings header still shows `@eko24ive/pi-ask` (`src/ui/settings-list.ts:158`), as does `docs/configuration.md:3`, although the 0.2.1 changelog says the configuration identity was corrected. Two tests pin the header. The `@eko24ive/pi-ask:*` event channels are intentional (README: shared with upstream).
- **Untested logic in any form:** `extractAskParams` retry, timeout, abort, and repair-after-retries; remote `flow_not_found` and `invalid_request`; spec scenario "Form construction fails before display" (`ask-program-status`); the 623-line `controller.ts` beyond the two fake-host tests and the Escape path.
- **Fallback path as a scope decision.** Pi 1.4.0 fallback accounts for the `pi-coding-agent-legacy` devDependency, 2 PTY cases, E17, and all of `src/program-status.ts` (207 lines). `peerDependencies` allow `*`, so this is a product decision, but the global instruction "do not preserve backward compatibility" makes it worth asking before building E17's variants. Dropping it would remove the whole of `program-status.test.ts` and contracts 7 and 8.
- **Precedent.** `740a8a5` already converted `ask-tool.test.ts` from hand-built hosts to real Pi (636 lines changed), so `host-plane.ts` is proven and the REPLACE work extends an existing pattern.
