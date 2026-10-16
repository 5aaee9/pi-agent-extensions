# Design

## Context

See `proposal.md` — Why. The publish step's decisions live in `scripts/release/publish-core.ts` and run against the `PublishOps` interface; `scripts/release/adapters.ts` wires the real Git, npm, and GitHub implementations, and `scripts/release/test/publish-world.ts` wires command doubles. Today `recordVersion` throws on the first unconfirmed lookup, `uploadAll` marks an already-published-but-invisible upload `failed`, and the whole engine is synchronous: every adapter call is a `spawnSync` (`npm`, `git`, `gh`) or a file read. `scripts/release/npm.ts` runs `npm view <name>@<version> version --json` for every lookup, and the tooling lint profile rejects `no-await-in-loop` and every other suppression, so a sequential wait loop cannot be written with `await`.

## Goals / Non-Goals

**Goals:**

- Record a version that the registry serves only after the upload, without a human rerun, on both the record path and the already-published upload path.
- Bound the extra CI time unconditionally, and fail with the same safety as today when the budget is exhausted.
- Keep the wait policy testable: no test sleeps in real time, and the backoff, the shared budget, and the clamping are asserted exactly.

**Non-Goals:**

- Retrying a lookup that errors (a failed lookup is not absence).
- Waiting for a version nothing in this run uploaded and the plan did not confirm.
- Any change to what a version publishes, to tags or Releases, to `.github/workflows/`, or to the plan.

## Decisions

**One deadline for the whole run, not one per version.** The wait lives in a new `scripts/release/registry-wait.ts`: `createWaitBudget(now)` returns a `WaitBudget` whose `remaining()` establishes the deadline on first use (`now() + 30 * 60_000`) and reports what is left, and the same budget is passed to every wait of the run, so the run's total waiting is bounded by 30 minutes regardless of how many versions it waits for. Per-version budgets were rejected because N versions of one batch could hold the `npm-release` concurrency group for 30×N minutes; an unbounded wait was rejected because it can hold a release hostage indefinitely.

**Exponential backoff: 5 s first, doubled, capped at 2 minutes.** `WAIT_FIRST_MS = 5_000`, `WAIT_MAX_MS = 120_000`, `WAIT_BUDGET_MS = 30 * 60_000`. Propagation is usually seconds, so the first polls are close together; the cap keeps the run at roughly 15 lookups over the budget instead of hammering the registry. A fixed-interval poll was rejected as both slower to confirm the common case and noisier; jitter was rejected because the concurrency group already serializes runs.

**The wait stays synchronous; the sleep blocks instead of yielding.** `PublishOps` extends a `WaitOps` of `registryHas`, `now`, `sleep`, and `log`. The real adapter uses `performance.now()` — monotonic elapsed time, because the budget is a hard ceiling that a backwards time correction must not extend — and `Atomics.wait` on a throwaway `SharedArrayBuffer`, which blocks without spinning and without turning the step into an async pipeline: the engine is already fully synchronous (`spawnSync`), the publish job does nothing else while it waits, and the tooling lint profile resolves `no-await-in-loop` to `deny` through its enabled categories, so an `await`-based loop would have to be rewritten as recursion through `uploadAll`, `recordVersion`, and `runPublish` to satisfy a rule the repository does not allow suppressing. Making the sleep asynchronous was considered and rejected for that reason; putting a `waitForVisibility` op in the adapters was rejected because it would move the decision under test out of `registry-wait.ts`, and real sleeps in tests were rejected as slow and flaky.

**The deadline is enforced before each wait, and each wait is clamped to the remaining budget.** The loop asks the budget what is left, computes `wait = min(interval, remaining)`, sleeps it, then looks the version up once more; so a lookup at the deadline can still succeed, no wait extends past it, and once the budget is gone a later version fails after its single lookup with no sleep at all. `runPublish` therefore keeps its synchronous signature.

**Both paths that can observe propagation wait.** `recordVersion` waits when the version is expected on the registry (its upload was `published` in this run, was confirmed `already published`, or the plan listed it as a record), and `uploadAll` waits when `npm publish` answers `cannot publish over the previously published versions` but the re-check does not confirm the version; on confirmation that upload becomes `already published` and later uploads continue. A `failed` or `not attempted` upload keeps its single lookup and its "not on the registry; not recorded" notice, because nothing uploaded it. A lookup error keeps failing immediately on both paths.

**Lookups revalidate: `npm view` gains `--prefer-online`.** A cached package document that predates the upload would answer "absent" for the whole budget, which is exactly the failure this change removes; npm's cache is shared by `npm publish` and every later lookup in the same job. A per-lookup throwaway cache directory was rejected as more moving parts for the same effect, and leaving caching alone was rejected as unsound for a check that decides live registry state.

**A timeout still fails the run and records nothing.** The error names the version and the exhausted wait, so `docs/releases.md`'s recovery story ("a rerun finds it published and creates the tag and Release") stays true. Reporting success instead was rejected: the workflow would claim a release that has no tag and no Release, and repairing that needs the manual investigation the engine exists to avoid.

## Risks / Trade-offs

- **A run can hold the `npm-release` concurrency group for up to 30 minutes** → bounded by the shared budget and documented in `docs/releases.md`; today's alternative costs a full rerun of the plan job (`npm ci`, `npm run check`, per-version worktrees), so waiting is the cheaper side of the trade.
- **A genuinely unpublished version now fails 30 minutes later instead of immediately** → the failure is unchanged in outcome, the log prints every attempt, and the version is only waited for when this run (or the plan) saw it on the registry.
- **`--prefer-online` makes every lookup revalidate, including the plan's** → one conditional-request per package on an already network-bound run; the correctness of the wait depends on it.
- **A wall clock that a time correction moves backwards would extend the deadline** → the adapter's `now` is `performance.now()`, monotonic elapsed time, `WaitOps.now` documents the precondition, and `scripts/release/test/registry-wait.test.ts` pins the countdown, the deadline's lazy start, and that a clock jumping forward ends the budget instead of extending it.
- **Virtual-clock tests cannot catch a wrong real timer** → the adapter's sleep is one `Atomics.wait` statement, and the tests assert the durations the wait asked for, which is where the policy lives.
- **A blocking sleep makes the job unresponsive for the duration** → acceptable by construction: the publish job only prints progress and exits, and the same block is what every other adapter call (`spawnSync`) already does; the budget bounds it.
