# Verification: `pi-model-trace`

Scenarios: `scripts/e2e/pi/pi-model-trace.e2e.ts`. Source regressions were applied with `mut.sh`, which restores the file.

## T1

The scratch tarball is `tarballFor("pi-model-trace")` extracted, with `data/unified_bank.json` removed and re-packed, then given to `world.install(name, tarball)`. The committed scenario bodies ran against it unchanged, from a throwaway copy outside the repository. The control is the same path with the file left in.

| Scenario                                                     | Regression applied                                              | Observed                                                                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| All five                                                     | Control: scratch re-pack with the bank present                  | 5 passed                                                                                                                                             |
| Bare `/model-trace`; bare and qualified id; retry; held turn | Bank removed from the scratch tarball                           | 4 failed, each with `ModelTrace failed: ENOENT: no such file or directory, open '…/agent/npm/node_modules/@indexyz/pi-model-trace/data/unified_ban…` |
| Ambiguous or unknown id                                      | Bank removed from the scratch tarball                           | Passed. See Findings                                                                                                                                 |
| Bare `/model-trace`                                          | Removed `data/unified_bank.json` from `files` in `package.json` | Failed with the same `ENOENT`                                                                                                                        |
| Bare `/model-trace`                                          | Bare branch returns an error                                    | Failed: `timed out waiting for the outcome of /model-trace`                                                                                          |
| Bare and qualified id                                        | Removed the unique-id match                                     | Failed: `timed out waiting for the outcome of /model-trace solo`                                                                                     |
| Bare and qualified id                                        | Removed `modelRegistry.find`                                    | Failed: `timed out waiting for the outcome of /model-trace other/shared`                                                                             |
| Ambiguous or unknown id                                      | Removed the ambiguity branch                                    | Failed: `Expected values to be strictly deep-equal`                                                                                                  |
| Retry                                                        | Never retries                                                   | Failed on the `有效回答 3/3` assertion, with the report as its message                                                                               |
| Held turn                                                    | Removed `await ctx.waitForIdle()`                               | Failed: `no probe may start while the turn is running`                                                                                               |

## Kept package cases

Regressions applied with `kept.sh`; a detected regression reports `Tests 1 failed | 11 skipped (12)`.

| Case                                                                                      | Regression applied                                      | Observed                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `attributes a sample of each bank model's own counts to that model`                       | None                                                    | Passes: all 24 models attributed to themselves                        |
| Same                                                                                      | Scoring inverted (`-beta * value`)                      | Failed                                                                |
| Same                                                                                      | Marginal score ignores the counts (`countNumbers([1])`) | Failed                                                                |
| Same                                                                                      | `softmax` no longer normalizes                          | Failed                                                                |
| `keeps prose numbers out of the sampled sequence`, corrected with an in-range prose count | Letter rule removed                                     | Failed                                                                |
| Same                                                                                      | Letter rule narrowed from `\p{L}` to `[A-Za-z]`         | Failed                                                                |
| `splits runs on letters…`                                                                 | Letter rule narrowed from `\p{L}` to `[A-Za-z]`         | Passed, so the corrected case is the only detector of this regression |
| `uses the current host…`, with the challenge assertion on the wire                        | `sampleLengths` returns a constant                      | Failed                                                                |
| Same                                                                                      | Lengths start at 92                                     | Failed                                                                |
| Same                                                                                      | Prompt says `1 到 100`                                  | Failed                                                                |

## README and release decision

`data/unified_bank.json` holds 24 models in 6 families: GPT 8, Claude 9, Gemini 1, GLM 1, Grok 2, Kimi 3. The README's "13 GPT/Claude candidates" now says this. Nothing else published changed, so `.changeset/model-trace-readme-candidates.md` records `none`.

## Findings

- **The ambiguous and unknown id scenario passes without the bank, and is meant to.** `resolveTarget` answers before `loadBank` runs. The other four scenarios guard the bank.
- **Audit deviation.** The audit and the design's table list 4 DELETE and 12 stay. `tasks.md` asks to correct `keeps prose numbers…`, so it stays and only 3 are deleted: `does not let saved thinking defaults…`, `parses comma and space separated runs`, and `returns an empty array for prose-only text`. `creates three challenges…` became assertions in the existing `uses the current host…` case, so it adds no case. Result: 16 cases, 3 DELETE, 1 merged, 0 to E2E, 12 stay (5 in `command.test.ts`, 7 in `fingerprint.test.ts`).
- **The held-turn scenario uses a 300 ms negative wait.** Nothing signals that a probe did not start. Removing `await ctx.waitForIdle()` failed on all five runs: three with `no report in transcript`, before the scenario was restructured to assert the notifications first, and the last two with `no probe may start while the turn is running`.
- **No new defects.** The installed package reads its bank through `import.meta.url` under the published bin.
