# Proposal

## Why

The compatibility audit found that existing package tests silently use several older Pi releases. CI must exercise the exact supported baseline and fail when a required local host is absent rather than testing a different version.

## What Changes

- Coordinate exact Pi 1.5.0 development pins across the eight Pi packages and regenerate the npm lockfile.
- Make the shared host smoke check verify the resolved Pi version against each package's manifest before loading it, and document the unified baseline.
- Keep DSH dependencies on their own existing pins; install the complete lockfile before verification.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-e2e-loading`: verify the resolved host matches each package's exact development pin. Package runtime changes remain in their own OpenSpec roots.

## Impact

Shared scripts/e2e, docs, lockfile, root package table and the eight Pi development manifests. Existing CI already invokes repository checks and host smoke tests, so strengthening that command enforces the baseline without another workflow. Runtime packages pi-custom-provider, pi-autocompact, pi-idle-compression, pi-model-trace and pi-ask receive patch intents in their own changes. Pin/documentation-only updates to pi-provider-sub2api, pi-continue and pi-skill receive none intents with that reason. No versions are prepared or published.
