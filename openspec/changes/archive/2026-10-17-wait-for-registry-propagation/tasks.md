# Tasks

## 1. The wait and its budget in the publish step

- [x] 1.1 Add `scripts/release/registry-wait.ts` with the `WaitOps` (registry lookup, clock, sleep, log), the `WaitBudget` interface, `createWaitBudget`, `waitUntilVisible`, and the 30-minute budget, 5-second first interval, and 2-minute cap constants; make `PublishOps` extend `WaitOps` and implement `now` and `sleep` in `createPublishOps` (monotonic `performance.now()`, and a blocking `Atomics.wait` because the engine is synchronous); verify `npm run typecheck` passes
- [x] 1.2 Wire the wait into `scripts/release/publish-core.ts`: `runPublish` creates one budget for the run, an extracted `uploadOne` waits when `npm publish` reports the version already published but the registry does not confirm it, and `recordVersion` waits for a version the run uploaded or the plan confirmed, failing with the exhausted-wait error after the budget and leaving a `failed`/`not attempted` upload to a single lookup; verify `npm run typecheck` and `npm run lint` pass
- [x] 1.3 Cover the record path in `scripts/release/test/publish-wait.test.ts` and `scripts/release/test/publish-record.test.ts`: a version visible after a delay is recorded with its tag and Release and the run succeeds; a version never visible fails naming the version and the exhausted wait, and creates no tag and no Release; a lookup that errors still fails immediately without waiting
- [x] 1.4 Cover the paths that must not wait: a `failed` or `not attempted` upload performs one lookup, records nothing, and sleeps zero times, in `scripts/release/test/publish-upload.test.ts`
- [x] 1.5 Cover the upload path in `scripts/release/test/publish-wait.test.ts`: "cannot publish over the previously published versions" with an unconfirmed re-check waits, becomes `already published`, records the version, and lets later uploads continue; the same case that never becomes visible leaves that upload failed

## 2. Test doubles for time and propagation

- [x] 2.1 Teach `scripts/release/test/publish-world.ts` a virtual clock: `now`/`sleep` doubles that advance it, `visibleAfter` on an upload to model propagation, and a record of every waited duration; verify the existing publish tests pass unchanged in behavior
- [x] 2.2 Cover the backoff and the shared budget in `scripts/release/test/publish-wait.test.ts`: the waited durations follow 5 s, 10 s, 20 s, ... with a 2-minute cap; once the first version has consumed the budget, a later unconfirmed version fails after a single lookup with no further sleep, and the sum of all waited durations never exceeds 30 minutes

## 3. Revalidating registry lookups

- [x] 3.1 Extract the `npm view` argument list into an exported function in `scripts/release/npm.ts`, add `--prefer-online`, and state in its comment that the lookup decides live registry state so a cached package document that predates the upload never answers it; verify `scripts/release/test/npm.test.ts` covers the arguments and keeps every `interpretView` case passing

## 4. Documentation

- [x] 4.1 Update `docs/releases.md`: the "Publish" bullet of "What CI does" states that an uploaded version the registry does not serve yet is waited for on an exponential backoff under one 30-minute budget shared by the run, that the same wait covers the already-published-upload re-check, and that lookups revalidate; verify the section names the budget and both paths
- [x] 4.2 Rewrite the registry-propagation row of the failure table: the run waits and records the version itself, a version still unconfirmed after the budget fails without a tag or Release, and a rerun remains the backstop; verify the row's outcome matches the error the step now prints for each case

## 5. Verification

- [x] 5.1 Run `npm run check` from the repository root and record the exact command and result
- [x] 5.2 Run `openspec validate wait-for-registry-propagation` from the repository root and confirm the change is valid, noting that its requirements carry the same >500-character warnings the two pending changes carry under `--strict`
- [x] 5.3 Confirm the change touches no package's published files (`git status --short` lists only `scripts/`, `docs/`, and `openspec/` paths) so no release intent is needed, and `npm run change:status` reports nothing to bump

## 6. Review follow-ups

Review of this plan and implementation by `magpie/codex/gpt-6-astra` (three independent reviewers: plan coherence, implementation defects, adversarial falsification) produced one false positive and three findings worth acting on. A second round by the same model re-adjudicated the fixes: all three resolved, the dismissal confirmed by rerunning the oxlint commands, the test split verified to preserve the original inventory, and no release-engine defect found.

- [x] 6.1 Make the hard budget independent of a non-monotonic wall clock: document in `WaitOps.now` that it must be monotonic elapsed time, use `performance.now()` in `createPublishOps` instead of `Date.now()`, and cover the countdown, the deadline's lazy start, a forward clock jump, and the exact-budget wait in `scripts/release/test/registry-wait.test.ts`; verify `npm run test:scripts` passes
- [x] 6.2 Name the rerun recovery in the upload path's timeout error, as the record path already does, and require that wording in `scripts/release/test/publish-wait.test.ts`
- [x] 6.3 Cover the boundary the spec promises: a version that becomes visible during the last, budget-clamped wait is still recorded (`visibleAfter: 1_800_000` in `scripts/release/test/publish-wait.test.ts`)
- [x] 6.4 Dismiss the reviewer finding that `design.md` wrongly claims the tooling profile rejects `no-await-in-loop`: `oxlint --disable-nested-config -c .oxlintrc.tooling.json --print-config` resolves `"no-await-in-loop": "deny"` from an enabled category, so the claim stands and the design keeps it (now naming the category)
- [x] 6.5 Split the wait-focused cases out of `scripts/release/test/publish-upload.test.ts` into `scripts/release/test/publish-wait.test.ts` after the added cases pushed the file past oxlint's 300-line limit, leaving the four non-wait upload cases behind; verify `npm run test:scripts` still runs every case (80 tests)

## Workflow follow-up

- Archive the change after the review requirements are satisfied.
