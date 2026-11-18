# Tasks

## 1. Scaffold the repository-owned fork

- [x] 1.1 Copy the installed `@juicesharp/rpiv-todo` source modules and package assets into `pi-todo/`, adapt the manifest to `@indexyz/pi-todo`, declare the required Pi host and runtime dependencies, and add strict TypeScript/Vitest configuration; verify every imported shipped module is present in the `files` allowlist.
- [x] 1.2 Add `pi-todo` to the root workspace and Pi extension manifest, register it in `scripts/e2e/pi/registrations.ts`, install workspace dependencies, and verify npm resolves the new workspace and the Pi package registration names the observable todo tool/command.

## 2. Compact newly persisted details

- [x] 2.1 Change the todo result details representation so action and parameters are enumerable persistence fields while the live result retains compatibility access to the complete state without serializing `tasks` and `nextId`; add unit tests that compare immediate details access with `JSON.stringify` output and cover mutation, read-only, error, and no-op calls.
- [x] 2.2 Route both direct state-changing results and nested-call custom entries through the compact details representation without changing tool content, overlay rendering, or state mutation behavior; verify existing task reducer/formatter tests and a custom-entry serialization test pass.

## 3. Replay compact and legacy records safely

- [x] 3.1 Extend branch replay validation to recognize compact operation records, apply them through the live reducer rules, retain legacy snapshot support, and skip malformed records while preserving the last valid state; verify mixed-format and invalid-record replay tests.
- [x] 3.2 Preserve custom-entry precedence while preventing direct custom-plus-tool-result double application and supporting nested-only custom records; verify replay tests for direct deduplication, nested durability, legacy fallback, and each state-changing action.

## 4. Document and release the fork

- [x] 4.1 Write the package README, changelog baseline, and license/install/development documentation describing the fork, stable runtime identifiers, and compact session persistence; update the root package table and verify all documented paths and commands exist.
- [x] 4.2 Record the first-release intent for `@indexyz/pi-todo` covering the new repository-owned package and session-size optimization; follow the repository's first-release minor bump policy and verify the release-impact gate recognizes the intent.

## 5. Integrate and verify the Pi package

- [x] 5.1 Run package formatting, lint, typecheck, unit tests, and the package-scoped Pi E2E scenario from the documented verification workflow; verify the package loads from its packed tarball and reports the registered todo capability without touching dsh packages.

## Workflow follow-up

- Archive the OpenSpec change after implementation and review are complete.
- Run the package verification again after archiving if any generated spec path changes.
