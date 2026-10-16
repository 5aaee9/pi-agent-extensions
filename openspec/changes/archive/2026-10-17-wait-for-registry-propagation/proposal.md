# Proposal

## Why

The publish job treats "npm accepted the upload but the registry does not serve the version yet" as a failure. `scripts/release/publish-core.ts` throws `not visible on the registry yet; rerun the workflow to record it`, the job exits non-zero, and a human must rerun the workflow so it finds the version published and creates the missing tag and GitHub Release. `@indexyz/dsh-autocompact@0.1.1` failed its publish this way on 2026-10-16. Registry propagation is normally seconds and occasionally minutes; waiting for it is both correct and cheaper than a rerun, and the upload has already succeeded by then, so the version cannot be un-uploaded anyway.

## What Changes

- **The publish step waits for a version it uploaded to become visible.** Instead of failing on the first unconfirmed lookup, it re-checks the registry on an exponential backoff (5 s, 10 s, 20 s, ... capped at 2 minutes) and continues with the tag and GitHub Release once the version is confirmed.
- **One hard 30-minute budget is shared by the whole publish run.** The deadline starts at the first wait and is never extended, so a run never spends more than 30 minutes waiting no matter how many versions need it. A version still unconfirmed when the budget runs out fails the run naming the version, and nothing is recorded for it, so today's rerun semantics stay as the backstop.
- **The same wait covers the upload race.** When `npm publish` answers "cannot publish over the previously published versions" but the immediate re-check does not show the version yet, the package waits and then counts as already published, instead of being marked failed. It is the same propagation race on a different code path.
- **A lookup is never answered from a cache that predates the upload.** Every `npm view` revalidates with `--prefer-online`, because a cached package document would make the wait ineffective and could keep answering "absent" for the whole budget.
- **Versions that genuinely are not on the registry are not waited for.** An upload that failed for any other reason, or was not attempted because an earlier upload failed, keeps its single lookup and its "not on the registry; not recorded" notice; a lookup that errors (anything but a 404) still fails immediately, because a failed lookup is not absence.
- **`docs/releases.md` states the wait**, its budget, and what a timeout leaves behind.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `package-releases`: the publish step gains a requirement that it awaits registry propagation on a shared, bounded budget before failing, covering both the record path and the already-published upload path. `openspec/specs/` is still empty — the capability is introduced by the pending `adopt-independent-package-releases` change and extended by the pending `support-dsh-packages` change — so this delta is written as an addition, exactly as those two did.

## Impact

- **Release engine:** a new `scripts/release/registry-wait.ts` (the run-wide budget, the backoff, and the clamped wait), `scripts/release/publish-core.ts` (both call sites and the extracted upload attempt), `scripts/release/adapters.ts` (the run's monotonic clock and its blocking sleep), `scripts/release/npm.ts` (revalidating lookups), and `scripts/release/test/publish-world.ts`, `scripts/release/test/publish-upload.test.ts`, `scripts/release/test/publish-wait.test.ts`, `scripts/release/test/registry-wait.test.ts`, `scripts/release/test/publish-record.test.ts`, and `scripts/release/test/npm.test.ts` (a virtual clock, propagation delays, the backoff, the shared budget, and the new cases).
- **Documentation:** `docs/releases.md` ("What CI does", and the registry-propagation row of the failure table).
- **Not touched:** no `.github/workflows/` change is needed (the publish job's default timeout already covers a 30-minute wait, and the tag and Release steps are unchanged), and no `plan.ts`, `gate.ts`, or package file changes.
- **Release decision:** no package's published files change — the change is root tooling and docs — so no release intent is needed for any of the seven packages.
- **Cost:** while a run waits, the `npm-release` concurrency group holds later pushes to `main` for up to 30 minutes. That is bounded and strictly better than the failed run it replaces.
