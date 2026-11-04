# Verification: `pi-ask`

Scenario files: `scripts/e2e/pi/pi-ask.e2e.ts` (Q1, Q2, Q4, Q7, Q10), `pi-ask-answer.e2e.ts` (Q6), `pi-ask-remote.e2e.ts` (Q5), `pi-ask-resume.e2e.ts` (Q3), `pi-ask-form.e2e.ts` (Q8, Q9), with `pi-ask-support.ts` shared. 25 scenarios; all passed on three consecutive runs of the whole set.

## Defect 6 before the fix

Package change: `pi-ask/openspec/changes/fix-answer-extraction-model-auth/`. Observed on the unfixed package through the installed tarball:

| Scenario                                | Observed before the fix                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Falls back to the chat model            | Timed out; the terminal showed `Error: Error: Provider is not configured: anthropic` |
| First configured model with credentials | Timed out; the terminal showed `Error: Error: Provider is not configured: keyless`   |
| Keyless chat model `keyless/k`          | Timed out; the terminal showed `Error: Error: Provider is not configured: anthropic` |
| Keyless chat model `bearer/b`           | Timed out; the terminal showed `Error: Error: Provider is not configured: anthropic` |
| Skips a model outside `--models`        | Passed: not on the auth path                                                         |
| Refuses a chat model outside `--models` | Passed: not on the auth path                                                         |

After the fix all six pass. A throwaway probe also ran `/answer` to an open form with the chat model's credentials given by `--api-key`, `$ENV`, `!command`, and a literal key with `authHeader: true`, so these users lose nothing to `hasConfiguredAuth`.

## Mutation proofs

| Scenario          | Regression applied                                       | Observed                                                                                                        |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Q1                | `ask-tool.ts` compares `ctx.mode` with `"interactive"`   | Timed out waiting for the question                                                                              |
| Q1                | Tool result built with `answers: {}`                     | `Scope: All packages` assertion fails                                                                           |
| Q2 submit key     | `isNativeEditorSubmitEnabled` returns `true`             | Timed out waiting for `second`: Enter submitted                                                                 |
| Q2 submit key     | Enter dispatched as `editSubmit` in `input.ts`           | Timed out waiting for `second`                                                                                  |
| Q2 submit key     | `editSubmit` handler does nothing                        | Timed out waiting for `Review answers`                                                                          |
| Q2 submit key     | `renderEditorBlock` keeps the Editor's borders           | "the editor's own border must not show"                                                                         |
| Q2 submit key     | Custom option's label not drawn above its editor         | Timed out waiting for `Type your own`                                                                           |
| Q2 `@`            | `setAutocompleteProvider` call removed                   | Timed out waiting for `probe-target.txt`                                                                        |
| Q2 `@`            | Provider constructed with no `fd` path                   | Timed out waiting for `probe-target.txt`                                                                        |
| Q2 `@`            | `triggerCharacters: []`                                  | **Not detected**; see Findings                                                                                  |
| Q3 submit, cancel | `appendPendingAskDismissal` call removed                 | Submit and cancel both fail at the `ask:pending-dismissed` entry check; RPC passes                              |
| Q3 cancel         | Scan ignores `ask:pending-dismissed` entries             | Timed out waiting for `ASK_MODEL_FINISHED`                                                                      |
| Q3 submit         | `"startup"` removed from the reopen reasons              | Timed out waiting for the reopening notice                                                                      |
| Q3 submit         | `stopReason` compared with `"tool_use"`                  | Timed out waiting for the reopening notice                                                                      |
| Q3 submit         | `ask:payload` entry type renamed                         | "the crash leaves the stored form"                                                                              |
| Q3 submit         | `sendUserMessage` removed from resume                    | Timed out waiting for the model's reply                                                                         |
| Q3 submit         | Resume flow reports source `"tool"`                      | Partial deep-equal on `started` fails                                                                           |
| Q3 RPC            | `ctx.mode !== "tui"` guard removed from resume           | Notification assertion fails                                                                                    |
| Q3 all            | `REOPEN_REASONS` gate removed                            | **Not detected**; see Findings                                                                                  |
| Q4                | `onSave` no longer calls `store.save`                    | "never saved autoSubmitWhenAnsweredWithoutNotes"                                                                |
| Q4                | Header back to `@eko24ive/pi-ask`                        | Timed out waiting for the overlay's header                                                                      |
| Q4                | `shouldAutoSubmit` always returns `false`                | Timed out waiting for `ASK_MODEL_FINISHED`, in the second process                                               |
| Q5 replay         | `sendUserMessage` removed from `sendAskResult`           | Timed out waiting for the replay's reply                                                                        |
| Q5 bridge         | Submit channel renamed                                   | Timed out waiting for the model's reply                                                                         |
| Q5 bridge         | Started channel renamed                                  | Timed out waiting for the model's reply                                                                         |
| Q5 bridge         | `completed` not emitted                                  | Partial deep-equal on `completed` fails                                                                         |
| Q5 no flow        | `flow_not_found` result not emitted                      | Result list is empty                                                                                            |
| Q5 no flow        | `unsubscribeSubmit()` removed from `disposeAll`          | **Not detected**; see Findings                                                                                  |
| Q5 no flow        | `remoteAsk.disposeAll()` removed from `session_shutdown` | **Not detected**; see Findings                                                                                  |
| Q6                | `hasConfiguredAuth` check removed                        | Four of six fail, as before the fix                                                                             |
| Q6                | Resolved-credentials check returns `true`                | First-configured scenario times out waiting for the form                                                        |
| Q6                | Preference loop ignores scope                            | Strict-equal assertion fails after the form is answered                                                         |
| Q6                | Fallback scope check removed                             | Timed out waiting for the scope refusal                                                                         |
| Q6                | Previous user turn dropped from the excerpt              | "the preceding turn reaches the extractor"                                                                      |
| Q6                | Extraction request sent with `tools: []`                 | Falls-back scenario fails                                                                                       |
| Q7                | `/answer` guard removed                                  | Timed out waiting for the refusal of `/answer`                                                                  |
| Q7                | Replay guard removed                                     | Timed out waiting for the refusal of `/answer:again`                                                            |
| Q7                | `/ask-settings` guard removed                            | Timed out waiting for the refusal of `/ask-settings`                                                            |
| Q8 guard, draft   | `shouldConfirmDirtyDismiss` always false                 | Both time out waiting for the notice                                                                            |
| Q8 config         | `confirmDismissWhenDirty` ignored                        | Timed out waiting for the model's reply                                                                         |
| Q8 guard          | Answers no longer count as dirty                         | Timed out waiting for the notice                                                                                |
| Q8 draft          | Typed text no longer counts as dirty                     | Timed out waiting for the notice                                                                                |
| Q8 guard          | Tab change leaves the notice armed                       | Timed out waiting for the notice to return                                                                      |
| Q9 preview        | Pane always shows the first row                          | Timed out waiting for the preview text                                                                          |
| Q9 preview        | `(recommended)` not drawn                                | `(recommended)` assertion fails                                                                                 |
| Q9 preview        | Custom layout not selected                               | "the pane must be gone"; see Findings for the first attempt                                                     |
| Q9 narrow         | `pushWrappedText` neither wraps nor truncates            | All three: `pi exited with 1`, `Rendered line 67 exceeds terminal width (90 > 12).` at 12 columns; see Findings |
| Q10               | `skills/` removed from `files`                           | `<name>ask-user</name>` missing from the system prompt                                                          |
| Q10               | `pi.skills` removed from the manifest                    | `<name>ask-user</name>` missing from the system prompt                                                          |

## Findings

**Regressions not detected, and why:**

- **`triggerCharacters`.** `triggerCharacters: []` passes Q2 because the mutation is equivalent on Pi 1.5.0: pi-tui's `setAutocompleteTriggerCharacters` always starts from `DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS = ["@", "#"]` (`components/editor.js`). The property in `autocomplete.ts` is redundant there. Q2 guards the behaviour itself, proven by removing the provider and by removing its `fd` path.
- **Remote listener disposal.** Removing `unsubscribeSubmit()`, or the whole `disposeAll()` call, leaves exactly one `flow_not_found` after `/reload`, and did after `/new` in an earlier version of the scenario. Pi tracks each extension's `pi.events` subscriptions and removes them itself (`trackEventBusSubscription`, `core/extensions/loader.js`, in both 1.5.0 and the legacy 1.4.0), so the leak the audit cites cannot occur on either pinned host. The scenario therefore guards the `flow_not_found` contract and the absence of a duplicate. The REPLACE row "remote runtime disposes active flows and submit listener" is deleted with no proof of `disposeAll`, because nothing outside the process can observe it. The catalog's `/new` variant became `/reload`.
- **`REOPEN_REASONS`.** Removing the reason gate passes all of Q3. On `/new` the new session's branch is empty, so the scan finds nothing with or without the gate. `/reload` could only reach the gate with an undismissed call in a live session, and the open form holds the input that would type `/reload`, so no run reached it. The mode guard and the `startup` reason are proven above; the rejected reasons `new` and `reload` have no proof.

**Scenario corrections the proofs forced:**

- **Q9 narrow.** With `pushWrappedText` overflowing, all three width scenarios first passed. Pi's default `tuiMode` is `fullscreen`, whose renderer does not throw; only `TuiMainScreen` (`tuiMode: "regular"`) has the "exceeds terminal width" check. The scenarios now set `tuiMode: "regular"`. On the default renderer they could never fail this way.
- **Q9 preview.** The first version asserted only that the option previews were gone, which also holds when the empty pane is still drawn, and it passed the mutation. It now also rejects `No preview available`.
- **Q2 `@`.** `fd` is the provider's only search path and CI has none, so the scenario puts a small `fd` script on `PATH`. The external tool is stubbed; Pi's editor, the provider, and the spawn are real.
- **Q3 mutation runs.** Two runs with an empty name pattern ended with exit 9 and ran no test. They were repeated with a pattern, and the rows above come from the repeats.

**New defect, not fixed, no scenario lands for it:**

- With `autoSubmitWhenAnsweredWithoutNotes` on, answering by digit leaves the form open on the review tab: the terminal still showed the review after 20 seconds and no model request arrived. The cause read from the code is that `numberShortcut` calls `commitState` without `finish: true` in `controller.ts`, unlike `confirm`. Enter does auto-submit, and Q4 uses it.

**Audit deviations:** none in the counts. DELETE 52, to E2E 23, stays 136, as in the Cleanup table; `vitest run` reports 136 passed in 22 files. The six emptied files are removed. `program-status.test.ts` keeps its five tracker cases and its escaping case, and `ask-flow-status.test.ts`, `pi-coding-agent-legacy`, and `pi-ask/package.json` are unchanged.

**Not verified:** `npm run release:gate` reports `@indexyz/pi-ask: no published changes` because it compares commits and this work is uncommitted. `npm run change:status` lists the intent. The orchestrator's commit needs the gate run for task 1.4 of the package change.
