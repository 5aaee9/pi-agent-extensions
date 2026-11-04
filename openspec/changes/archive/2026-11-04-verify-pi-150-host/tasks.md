# Tasks

## 1. Host verification

- [x] 1.1 Update all eight Pi host pins to 1.5.0 and regenerate the npm lockfile; verify installed versions resolve correctly from each package.
- [x] 1.2 Verify the resolved host version in the smoke runner and run its public CLI with matching and mismatched pins; update workflow and reference documentation.
- [x] 1.3 Update package baseline documentation and the root table; record a release intent for every changed published manifest.

## 2. Integration

- [ ] 2.1 Run npm run check and npm run test:e2e after package fixes, recording exact outcomes.

## Workflow follow-up

- Review and archive the completed change with its spec delta.

## Verification record (2026-11-04)

- All eight Pi packages resolve their declared host dependencies at 1.5.0. The public smoke command rejects an intentionally mismatched pin before loading the extension.
- Pi package tests: 720 passed. The latest public-CLI corrections passed targeted checks again (`pi-ask`: 211; `pi-model-trace`: 16).
- `npm run test:e2e`: 12/12 hosts loaded successfully, including all eight Pi packages.
- `npm run test:scripts`: 85 passed.
- `npm run check` passed formatting, lint, type checking, builds, and all Pi tests, but exited 1: four existing `dsh-autocompact` web tests timed out waiting for the `autocompact-workspace` button. The browser cache was supplied through `PLAYWRIGHT_BROWSERS_PATH`; this was not a missing-browser error. DSH source files were not modified.
- The owner restricted the task to Pi. DSH failures are recorded without further investigation; the local full-workspace gate remains incomplete.

## Archive decision (2026-11-04)

The owner explicitly requested archive, commit, and publication after being told about the four DSH UI failures. Archive preserves the incomplete full-workspace verification checkbox and its evidence; it does not claim the local gate passed. The publication workflow retains its full repository gate.
