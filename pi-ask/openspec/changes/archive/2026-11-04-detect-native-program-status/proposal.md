# Proposal

## Why

The user requires native OSC status when the host implements it and a fallback otherwise. Comparing a version string does not detect backported or differently versioned host capabilities; mocked tool tests also miss the host's actual schema and dialog behavior.

## What Changes

- Detect whether the active custom dialog consumes the blocked option, without comparing Pi versions.
- Preserve fallback OSC reporting and restoration only for hosts without native handling; keep disabled/non-TTY behavior.
- Verify real Pi 1.5 and a pinned earlier host in a PTY, and exercise tool arguments through a real host and local model protocol server.
- Correct the tested version and fork package identity in the README and configuration prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ask-program-status`: select native status by observed host support rather than release number, while retaining fallback behavior.

## Impact

pi-ask program-status and UI controller, real-host tests and test-only dependencies, README and configuration prompt. A patch release intent is required; versions are not prepared.
