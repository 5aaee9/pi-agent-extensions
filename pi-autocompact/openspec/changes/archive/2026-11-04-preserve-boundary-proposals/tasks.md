# Tasks

## 1. Preserve boundary composition

- [x] 1.1 Add a real-host regression with a preceding boundary extension and observe it failing before the fix.
- [x] 1.2 Preserve preceding proposals, then verify metadata order and context omissions with the regression and existing package tests.
- [x] 1.3 Document preserved boundary entries in the README and record one patch intent for the package.

## 2. Integration verification

- [ ] 2.1 Pass the package typecheck, root `npm run check`, and Pi 1.5.0 RPC load smoke test.

## Workflow follow-up

- Archive after the coordinated repository verification and review finish.

## Verification record (2026-11-04)

- Package type checking/tests and the Pi 1.5.0 RPC loading check passed.
- New lifecycle regressions ran through the real Pi host and local HTTP, failed before the runtime fix, and passed afterwards.
- The coordinated full-workspace check failed only in four DSH UI tests; see the root `verify-pi-150-host` verification record. DSH is outside the owner-approved scope. Main specs are synced.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
