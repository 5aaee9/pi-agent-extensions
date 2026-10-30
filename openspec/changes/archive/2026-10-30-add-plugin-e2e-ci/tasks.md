# Tasks

## 1. Runner foundation and discovery

- [x] 1.1 Add the root `test:e2e` script and strict TypeScript runner entry under `scripts/e2e/`; verify the runner starts from the repository root and reports its version-independent workspace context.
- [x] 1.2 Implement workspace manifest discovery for Pi and DSH packages, including validation of required manifest fields and deterministic package ordering; verify a fixture or focused test covers supported and ignored workspace manifests.
- [x] 1.3 Add bounded command execution, timeout handling, output capture/truncation, and package result aggregation; verify a focused test proves one failure does not prevent later package checks and produces a non-zero final result.

## 2. Host loading checks

- [x] 2.1 Implement Pi RPC loading using the package-local compatible `pi` binary, offline environment, empty agent directory, `get_commands` request, response validation, and actionable diagnostics; verify it passes against every current Pi package locally.
- [x] 2.2 Implement DSH packaged loading using build, tarball, isolated install, and the package's declared `release.smoke` command; verify it passes against every current DSH package locally and cleans temporary artifacts.
- [x] 2.3 Add stable human-readable summary output and optional local debugging filters/timeouts without changing the default full-discovery behavior; verify the summary reports total, passed, failed, command, duration, and failure output.

## 3. CI and documentation integration

- [x] 3.1 Add `npm run test:e2e` to the existing CI quality workflow after the repository check; verify the workflow YAML invokes the exact root script on a clean Node/npm installation.
- [x] 3.2 Document local E2E execution, offline guarantees, package discovery rules, and common failure diagnostics in repository workflow documentation; verify the documented command matches the package script.
- [x] 3.3 Run `npm run check` and `npm run test:e2e` from the repository root, then verify the full discovered Pi and DSH plugin set passes with no generated artifacts added to Git.

## Workflow follow-up

- Archive this change after implementation review and verification.
- Confirm the archived capability remains truthful in the root OpenSpec specs.
