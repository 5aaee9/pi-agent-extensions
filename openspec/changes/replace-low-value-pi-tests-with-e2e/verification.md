# Verification

Each scenario's proof that it detects its failure: the regression applied to a scratch copy, never committed, and what was observed. `design.md` D7 explains why this is recorded rather than automated. Record only what a run printed; a regression a scenario did not detect is recorded as such, with what that showed. Per-package records are in `verification/`.

## Final runs

- `npm run test:e2e:pi`: 154 scenarios across 36 files, about 25 seconds, passing on three consecutive runs before the host fix and again after it.
- The 80 `pi-provider-sub2api` scenarios are the catalog's P1 to P10; rows that share a relay inventory collapsed into them.

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
