# Verification

Each scenario's proof that it detects its failure: the regression applied to a scratch copy, never committed, and what was observed. `design.md` D7 explains why this is recorded rather than automated. Record only what a run printed; a regression a scenario did not detect is recorded as such, with what that showed.

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
