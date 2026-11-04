# Tasks

## 1. End idle periods at compaction start

- [x] 1.1 Add real-host failed and cancelled compaction regressions and observe them failing before the fix.
- [x] 1.2 Cancel the idle period when compaction starts, then verify no repeat summary occurs and a later settled run can arm a fresh period.
- [x] 1.3 Document failure/cancellation and idle cache-warming interaction in the README and record one patch intent.

## 2. Integration verification

- [ ] 2.1 Pass the package typecheck and tests, root `npm run check`, and Pi 1.5.0 RPC load smoke test.

## Workflow follow-up

- Archive after the coordinated repository verification and review finish.

## Verification record (2026-11-04)

- Package type checking/tests and the Pi 1.5.0 RPC loading check passed.
- New lifecycle regressions ran through the real Pi host and local HTTP, failed before the runtime fix, and passed afterwards.
- The coordinated full-workspace check failed only in four DSH UI tests; see the root `verify-pi-150-host` verification record. DSH is outside the owner-approved scope. Main specs are synced.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
