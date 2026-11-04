# Tasks

## 1. Runtime detection

- [x] 1.1 Replace version gating with native blocked-option consumption detection and retain fallback restoration; verify real 1.5 and 1.4 TUI forms and disabled reporting.
- [x] 1.2 Replace touched mocked tool/dialog checks with real-host schema and non-TUI tests; verify prepared labels, invalid input and persisted payloads through actual tool execution.
- [x] 1.3 Correct README baseline and configuration prompt package identity; record a patch intent and verify host-injected prompt text.

## 2. Integration

- [ ] 2.1 Run package checks, root npm run check and RPC smoke, recording terminal interaction outcomes.

## Workflow follow-up

- Review and archive the completed change with its spec delta.

## Verification record (2026-11-04)

- Package type checking/tests and the Pi 1.5.0 RPC loading check passed.
- Real Pi 1.5.0 and 1.4.0 PTY sessions exercised native/fallback OSC, cancellation, resize without duplicate blocked records, and disabled reporting. Real JSON/RPC sessions verified schema preparation, errors, persisted payloads, and injected prompt identity.
- The coordinated full-workspace check failed only in four DSH UI tests; see the root `verify-pi-150-host` verification record. DSH is outside the owner-approved scope. Main specs are synced.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
