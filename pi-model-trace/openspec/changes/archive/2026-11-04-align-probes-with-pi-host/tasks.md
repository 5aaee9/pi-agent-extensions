# Tasks

## 1. Host and execution lifecycle

- [x] 1.1 Resolve the current host, retain the explicit executable override and forward thinking off; verify all three probe requests through a real RPC/HTTP regression test with no Pi on PATH.
- [x] 1.2 Delegate execution limits and cancellation to Pi, exclude failed output from attribution and cancel on shutdown; verify failures and cancellation through real process/RPC behavior.
- [x] 1.3 Update the README for the host requirement and probe behavior, and record one patch release intent; verify both artifacts match the implemented behavior.

## 2. Integration

- [x] 2.1 Run package typecheck/tests and the Pi load smoke test, validate this change with OpenSpec and pass results to the repository-wide check owner.

## Workflow follow-up

- Archive after repository-wide verification and review are complete.

## Verification record (2026-11-04)

- Package type checking/tests and the Pi 1.5.0 RPC loading check passed.
- Real public-CLI/RPC/HTTP runs verified host resolution without Pi on PATH, explicit executable selection, thinking off, failed/truncated output exclusion, and shutdown cancellation. The ten-minute timeout and standalone compiled executable were not exercised.
- The coordinated full-workspace check failed only in four DSH UI tests; see the root `verify-pi-150-host` verification record. DSH is outside the owner-approved scope. Main specs are synced.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
