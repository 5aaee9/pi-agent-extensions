# Verification: `pi-skill`

Scenarios: `scripts/e2e/pi/pi-skill.e2e.ts`. Package change: `pi-skill/openspec/changes/fix-skill-reference-directory/`. Each regression was applied with `mut.sh` to the package source, which restores the file.

| Scenario                                                                                | Regression applied                                            | Observed                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| K1 parity: "$known and /skill:known give the model the same block, ahead of the prompt" | None: run before the fix, on `sourceInfo.baseDir` (defect 2)  | Failed. `actual` said `References are relative to …/agent.`, `expected` said `…/agent/skills/known.` |
| K1 parity                                                                               | Fix applied (`dirname(filePath)`)                             | Passes                                                                                               |
| K1 parity                                                                               | Restored `command.sourceInfo.baseDir ?? dirname(filePath)`    | Failed: `Expected values to be strictly equal`                                                       |
| K1 parity                                                                               | Deferred the block's `sendMessage` to `deliverAs: "nextTurn"` | Failed: `no skill block in {"role":"user","text":"$known hi"}`                                       |
| K1 literal: "$$known reaches the model as written, with no skill block"                 | Removed the `(?<!\$)` lookbehind from the token pattern       | Failed: `Expected values to be strictly deep-equal`                                                  |
| K1 queued: "a steered $known…" and "a follow-up $known…"                                | Dropped `deliverAs` from the queued `sendMessage`             | Follow-up failed, steer passed. See Findings                                                         |
| K1 queued, both                                                                         | Swapped `steer` and `followUp`                                | Both failed                                                                                          |
| K2: "typing $ in a terminal offers the skill, and sending it renders a collapsed block" | Removed `triggerCharacters: ["$"]`                            | Failed: `timed out waiting for "a known skill"`                                                      |
| K2                                                                                      | Renderer always returns `undefined`                           | Failed: `timed out waiting for "[skill] known"`                                                      |
| K2                                                                                      | Removed `ctx.ui.addAutocompleteProvider`                      | Failed: `timed out waiting for "a known skill"`                                                      |
| K2                                                                                      | `applyCompletion` keeps the line unchanged                    | Failed: `timed out waiting for "$known "`                                                            |

Kept package cases, regression applied with `kept.sh`:

| Case                                                                                | Regression applied            | Observed                            |
| ----------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| `discovers skills on disk…`, now comparing with Pi's `skill.baseDir`                | Restored `sourceInfo.baseDir` | `Tests 1 failed \| 12 skipped (13)` |
| `leaves unknown tokens and prices untouched`, now on `failed` and `blocks`          | Removed the `!skill` guard    | `Tests 1 failed \| 12 skipped (13)` |
| `keeps $$name literal as an escape`, now on `expanded` and `blocks`                 | Removed the lookbehind        | `Tests 1 failed \| 12 skipped (13)` |
| `reports a missing skill file as failed`, now on `expanded`, `failed`, and `blocks` | Removed `failed.push(name)`   | `Tests 1 failed \| 12 skipped (13)` |
| `injects one message per distinct skill…`                                           | Removed the `seen` guard      | `Tests 1 failed \| 12 skipped (13)` |

Five consecutive runs of `pi-skill.e2e.ts` together with `pi-model-trace.e2e.ts`: 10 of 10 passed each time, about 4.5 seconds per run.

## `$$name` on the wire

The model receives the user message `$$known hi` with both dollar signs and no skill block, so the README's "literal `$name`" was wrong. The README now states this behaviour.

## Findings

- **Queued steer with `deliverAs` dropped is an equivalent mutation.** Pi's `sendCustomMessage` steers by default while streaming (`agent-session.js:1875-1880`), so the steer scenario passes when `deliverAs` is dropped. The follow-up scenario fails and the swap fails both, so both modes are guarded.
- **Queued delivery is unchanged.** Both queued scenarios assert only whether the request carrying the tool result holds the block, with no assertion on turn count, as the owner has not yet decided how queued skills should be delivered.
- **Audit deviations.** Case counts match the design: 24 cases, 6 DELETE, 5 to E2E, 13 stay. Three things differ from the audit's rows:
  - Removing the dead `text` field also moved `keeps $$name literal` and `reports a missing skill file` off `text`; the audit named this move only for `leaves unknown tokens`. The second case lost "and leaves the token" from its name, because that is now covered by the prompt assertion in K1.
  - `$$known` has its own scenario, although the design's recorded list says no scenario asserts it. The owner asked for the README to state the behaviour observed on the wire, and this scenario guards that sentence.
  - The `$code-notes.md` working-directory fixture went with `delegates when no skills are loaded`, its only user.
- **`index.ts` changes beyond the base directory.** The published file also loses the unread `text` result, with its string rebuild. The handler's behaviour is unchanged, and the K1 and K2 mutations above ran after this removal.
- **No new defects.**

## Not verified

`npm run release:gate` needs a commit, and this agent does not commit. `npm run change:status` lists `@indexyz/pi-skill`.
