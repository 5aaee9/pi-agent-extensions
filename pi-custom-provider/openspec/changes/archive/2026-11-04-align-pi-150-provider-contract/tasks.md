# Tasks

## 1. Provider contract

- [x] 1.1 Convert Ollama to current transcript helpers and host types; verify the package typecheck and real-host tool/prompt regression tests.
- [x] 1.2 Await stream observation and align request options; verify observer ordering and failure through the registered provider and local HTTP.
- [x] 1.3 Document the Pi 1.5.0 baseline and corrected Ollama behavior, and record the package release intent.

## 2. Integration verification

- [x] 2.1 Run the package tests and real Pi CLI Ollama request against a local endpoint, confirming tool declarations reach the request.
- [ ] 2.2 Complete the repository-wide check, Pi load smoke, and required review in coordination with the root change.

## Workflow follow-up

- Archive after coordinated verification and review complete.

## Verification record (2026-11-04)

- Package type checking/tests and the Pi 1.5.0 RPC loading check passed.
- Real host/local HTTP regressions verified current tools and prompt sections, tool continuation, and awaited observer success/failure; the real Pi CLI request included tool declarations. External provider services were not exercised.
- The coordinated full-workspace check failed only in four DSH UI tests; see the root `verify-pi-150-host` verification record. DSH is outside the owner-approved scope. Main specs are synced.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
