# Verification

Each scenario's proof that it detects its failure: the regression applied to a scratch copy, never committed, and what was observed. `design.md` D7 explains why this is recorded rather than automated.

| Scenario           | Regression applied                                             | Observed                                                                                                                       |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| X1 (load check)    | `fingerprint.ts` removed from `pi-model-trace`'s `files`       | `npm run test:e2e -- --package @indexyz/pi-model-trace` fails: `Cannot find module './fingerprint.ts'` from the installed copy |
| X2                 | `pi-custom-provider` command renamed                           | `refresh-custom-provider-models` assertion fails                                                                               |
| X2                 | `pi-skill` `input` handler returns early                       | "pi-skill did not deliver the skill block"                                                                                     |
| X3                 | Uncleared `setInterval` added to `pi-continue`                 | "run did not exit within the bound"                                                                                            |
| X3                 | `session_start` handler throws on `reason === "new"`           | `extensionErrors` not empty                                                                                                    |
| N1                 | Removed `await ctx.waitForIdle()` after `sendMessage`          | `-p /continue` exits 1, re-printing the old 400                                                                                |
| N2                 | `findInterruptedTurn` stops recognizing `aborted`              | No retry reaches the model; roles assertion fails                                                                              |
| N3 (repeat)        | `findInterruptedTurn` stops skipping the persisted marker      | Second `/continue` sends no request                                                                                            |
| N3 (idle)          | Removed `await ctx.waitForIdle()` before reading the branch    | "no model request may start while compaction is running"                                                                       |
| `pi-continue` kept | 173d51d guard reduced to `!ctx.model`                          | "requires a currently selected model" fails on `bin.pi`                                                                        |
| `pi-continue` kept | `findInterruptedTurn` stops recognizing `error` (05143b3 area) | "retries a provider error" fails on `bin.pi`                                                                                   |
| `pi-continue` kept | Context hook stops removing the failed assistant turn          | "removes retry markers" fails on the wire                                                                                      |

Note: the same "keep the failed turn" regression does not fail N2 or N3. Pi's own conversion drops an empty failed assistant message, so the failure only shows with partial content, which the kept package test seeds.
