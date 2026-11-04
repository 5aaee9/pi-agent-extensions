# Design

## Context

See proposal.md for motivation. Pi 1.5.0 supplies `pi.exec()` with timeout, AbortSignal and combined output limits. Its `getPackageDir()` identifies the host installation mapped into loaded extensions. Existing probes run as child CLI sessions and preserve project resource discovery.

## Goals / Non-Goals

**Goals:** Keep CLI isolation and deterministic host/model selection while delegating process management to Pi.

**Non-Goals:** Change fingerprint scoring, introduce additional provider calls or add a generic subprocess framework.

## Decisions

- Resolve the installed host CLI from the `bin.pi` entry of the manifest in `getPackageDir()` and use the current runtime. This selects the public bundled CLI shipped by the host instead of an internal entry point. Compiled standalone hosts use their executable directly. This also works for SDK hosts without accidentally re-running the embedding application. Keep `PI_MODEL_TRACE_BIN` as an explicit override.
- Use `pi.exec()` with a ten-minute timeout and one-MiB combined output bound. A numeric probe is small; a MiB leaves ample room for startup diagnostics while bounding accidental verbose output. Failed executions discard stdout for attribution rather than scoring incomplete sequences.
- Give each command one AbortController and abort it on `session_shutdown`; propagate the command context signal when one exists. Do not retry or publish after cancellation.
- Exercise the registered command through actual Pi RPC and its HTTP provider against a local SSE server. Check missing PATH Pi, thinking `off`, explicit override and failed process output through observable requests/reports.

## Risks / Trade-offs

- Standalone binary layouts cannot be run in this Node-only environment; use Pi's documented current-executable detection pattern and report that limitation.
- A separate child process discovers persisted/project resources, not providers registered only in the parent's memory. Preserve this existing isolation contract.
- A one-MiB cap may stop unusually verbose extensions loaded in probes; the report names the output limit rather than silently accepting incomplete output.
