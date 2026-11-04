# Proposal

## Why

ModelTrace resolves probe processes through `pi` on PATH, which can run a different Pi release from the parent session or fail when Pi was invoked by an absolute path. It also drops an explicit thinking level of `off` and duplicates process execution that Pi 1.5.0 now provides.

## What Changes

- Launch probes through the current Pi host by default while retaining `PI_MODEL_TRACE_BIN` as an explicit override.
- Forward the selected thinking level, including `off`.
- Use Pi's process executor for bounded output, timeout and cancellation, and stop active probes on session shutdown.
- Verify the public command through real RPC sessions and a local HTTP model endpoint.

## Capabilities

### New Capabilities

- `model-probes`: Independent probe execution, host selection and report lifecycle.

### Modified Capabilities

None.

## Impact

Changes stay within pi-model-trace runtime, tests and README, plus its patch release intent. Pi 1.5.0 is the target host; shared dependency pins and CI are handled by the repository-wide upgrade.
