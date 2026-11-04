# Verification

Each scenario's proof that it detects its failure: the regression applied to a scratch copy, never committed, and what was observed. `design.md` D7 explains why this is recorded rather than automated. Record only what a run printed; a regression a scenario did not detect is recorded as such, with what that showed. Per-package records are in `verification/`.

## Final runs

- `npm run test:e2e:pi`: 159 scenarios across 36 files, about 26 seconds. From a clean `npm ci`, the 154 at that point passed on three consecutive runs; the scenarios added since passed on each later full run, including with `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set in the calling shell.
- The 80 `pi-provider-sub2api` scenarios are the catalog's P1 to P10; rows that share a relay inventory collapsed into them.

- `npm run test:e2e`: 12 of 12 plugins pass, DSH included. Eight Pi load smoke tests pass; `pi-provider-sub2api`, `pi-custom-provider`, and `pi-skill` list no commands unconfigured, as expected.
- `npm run release:gate -- --base origin/main --head HEAD`: passes; every DSH package reports no published changes.
- `npm run check`: CI's run on the draft pull request passes it, DSH included. On this machine it fails only on four `dsh-autocompact/test/client-plane.test.ts` browser cases, which fail the same way on untouched `main`, so they are local to this machine and unrelated to this change.

## Found by the implementation review and CI

| Finding                                                                                                                                    | Regression or evidence                                                      | Observed                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `$$name` README regressed by a patch script: `String.replace` reads `$$` as `$`, so the line said `$name` does not invoke a skill          | All four reviewers read the file                                            | Corrected; later patches use function replacements                                          |
| X3 accepted extension errors in print and JSON, which exit 0                                                                               | `session_start` throws only in print and JSON                               | Now fails on `Extension error` in stderr; previously 11/11 passed                           |
| A scenario timeout skipped teardown, because Node's test timeout does not reject the body                                                  | Real RPC host and server, body never resolving, deadline shortened to 1.5 s | `scenario exceeded 1500 ms`; afterwards the world directory is gone and no process names it |
| Three scenarios failed on CI with `spawn E2BIG`: 200,000-character prompts in argv exceed Linux's 128 KiB per argument, which macOS allows | CI run on the draft pull request                                            | Moved to Pi's `@file` input through `world.largePromptArg`                                  |
| X3's "model change" reselected the same model                                                                                              | Reading the scenario                                                        | Switches to a second model and asserts it on the wire                                       |
| sub2api offline cold start passed with the extension not loading                                                                           | `if (process.env.PI_OFFLINE) return;`                                       | Now fails: the extension must still register `sub2api-refresh`                              |
| Custom-provider refresh under offline had no scenario                                                                                      | The command gated on offline                                                | Fails: "the explicit refresh must reach upstream"                                           |
| A temporary root under a project would load its skills                                                                                     | Reviewer's run with `TMPDIR` inside the checkout                            | The harness refuses it, naming the marker                                                   |

The `@file` move itself broke an assertion, found in the second review round: Pi wraps a file's content in `<file>`, so A2's `startsWith("first")` could no longer fail. It now looks for a marker inside the text; a boundary that keeps all history fails it (`firstKeptEntryId` set to the earliest entry). A refused temporary root also left an empty directory; the check now runs before the directory exists, confirmed with `TMPDIR` under a project: refused, nothing left behind.

**Abort is guarded three times, so a single regression cannot show.** Removing the outcome check, or the `ctx.signal` check, or both, still sends no summary, because the summarizer's request is bound to the same signal. Only removing the signal from both places fails "aborting a running tool over the threshold...", which proves the scenario reaches the code. Pi reports the aborted tool's turn as `completed` with the signal aborted, then a second `turn_end` as `error`, and an abort mid-stream as `aborted`.

## Upgrade rehearsal

`node scripts/e2e/pi/rehearse.ts --throwaway --version 1.4.0` in a throwaway worktree:

| Step                 | Result on Pi 1.4.0                                                                                                | Evidence                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifests            | Only the eight Pi `package.json` files and the lockfile change; `pi-ask`'s legacy alias and `dsh-*` are untouched | `git status`, `git diff -- 'dsh-*'` empty                                                                                                                                                  |
| typecheck            | FAILED                                                                                                            | `pi-model-trace/index.ts(76,5)`: `maxBuffer` not in `ExecOptions`; `pi-ask/src/ui/controller.ts(141,13)`: `blocked` unknown; `pi-provider-sub2api` and `pi-custom-provider` provider types |
| package tests        | FAILED                                                                                                            | `pi-custom-provider` 1 of 54, `pi-model-trace` 2 of 12                                                                                                                                     |
| load check           | Passed                                                                                                            | All eight load on 1.4.0                                                                                                                                                                    |
| end-to-end scenarios | FAILED, 1 of 154                                                                                                  | "aborting a running tool and continuing...": Pi 1.4.0 records that turn differently                                                                                                        |

**The first run proved nothing.** All 153 scenarios passed, which looked wrong given what typecheck had found. The harness resolved `pi` from the workspace root, which keeps its own 1.5.0 copy while the pins move the packages' nested copies, so the rehearsal's scenarios ran the old Pi and would have done so against `latest` too. The harness now resolves the host from a Pi package, refuses a version that differs from the pin, and has a scenario for it; the rehearsal prints the host it ran (`1.4.0`).

## Harness and cross-package

| Scenario        | Regression applied                                       | Observed                                                                                                                       |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| X1 (load check) | `fingerprint.ts` removed from `pi-model-trace`'s `files` | `npm run test:e2e -- --package @indexyz/pi-model-trace` fails: `Cannot find module './fingerprint.ts'` from the installed copy |
| X2              | `pi-custom-provider` command renamed                     | `refresh-custom-provider-models` assertion fails                                                                               |
| X2              | `pi-skill` `input` handler returns early                 | "pi-skill did not deliver the skill block"                                                                                     |
| X3              | Uncleared `setInterval` added to `pi-continue`           | "run did not exit within the bound"                                                                                            |
| X3              | `session_start` handler throws on `reason === "new"`     | `extensionErrors` not empty                                                                                                    |

## pi-continue

| Scenario                                    | Regression applied                                             | Observed                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1                                          | Removed the print and JSON `waitForIdle`                       | `-p /continue` exits 1, re-printing the old 400                                                                                                               |
| N2                                          | `findInterruptedTurn` stops recognizing `error`                | Timed out: no retry ran. Pi records an aborted tool turn as `error`, not `aborted`                                                                            |
| N3 repeat                                   | `findInterruptedTurn` stops recognizing `error`                | Timed out: second `/continue` starts no turn                                                                                                                  |
| N3 restart                                  | Non-message entries end the scan (`return undefined`)          | Timed out: restart reports nothing to continue. The scenario must wait for the request to reach the server before killing, or the marker is not yet persisted |
| N3 idle                                     | Removed `await ctx.waitForIdle()` before reading the branch    | "no model request may start while compaction is running"                                                                                                      |
| Kept: "requires a currently selected model" | 173d51d guard reduced to `!ctx.model`                          | Fails on `bin.pi`                                                                                                                                             |
| Kept: "retries a provider error"            | `findInterruptedTurn` stops recognizing `error` (05143b3 area) | Fails on `bin.pi`                                                                                                                                             |

Findings from regressions that did **not** fail, which changed the plan:

- Keeping the failed assistant turn (`messages.pop()` removed) fails nothing, and disabling the whole `context` hook leaves the request on the wire identical. Pi 1.5.0 already drops errored and aborted assistant messages and empty custom messages. So the kept case "removes retry markers and their failed assistant turns from every model context" passed regardless and was removed under the assertion requirement, moving `pi-continue` to 5 DELETE, 1 to E2E, 7 stay. The hook itself is runtime code and was left alone; it is reported as likely redundant.
- Removing the `custom`-role marker skip in `findInterruptedTurn` fails nothing: persisted markers are `custom_message` entries, skipped one line earlier, so that line is unreachable from real sessions.
- A wait after `sendMessage` in every mode blocked the RPC `prompt` response until the turn ended. The fix is limited to print and JSON modes; the restart scenario would otherwise time out.
