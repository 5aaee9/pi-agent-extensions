# Tasks

## 1. Package scaffold and upstream integration

- [ ] 1.1 Copy the upstream pi-ask implementation, tests, contract/docs, and skill content into the new package while preserving the module boundaries; verify all intended TypeScript and documentation files are present and no upstream build artifacts are included.
- [ ] 1.2 Create the repository-native package manifest, TypeScript/Vitest configuration, license, changelog, and OpenSpec context; add the workspace and root Pi manifest entries; verify `npm install` updates the workspace lockfile successfully.

## 2. Tool contract adaptation

- [ ] 2.1 Rename the registered tool and all public schema, descriptions, renderers, result, persistence, replay, recovery, and local event identifiers from `ask_user` to `ask_user_question`; verify unit tests assert the new name and no old registration remains.
- [ ] 2.2 Update contract, architecture, README, and skill documentation to describe `ask_user_question`, replay/recovery behavior, and the adapted package identity; verify every documented command and tool name matches the implementation.
- [ ] 2.3 Add or migrate tests for valid/invalid payloads, normalized answers, notes, elaboration, non-TUI behavior, replay, recovery, and explicit remote responses; verify the package test suite passes under Vitest.

## 3. Configuration adaptation

- [ ] 3.1 Change the configuration path resolution to use `pi-ask.json` under Pi's agent directory (respecting `PI_CODING_AGENT_DIR`) while retaining the upstream schema, migrations, defaults, live updates, and safe handling of invalid files; verify path, default, migration, and invalid-file tests cover the new filename.
- [ ] 3.2 Document the `pi-ask.json` location and configuration behavior in the package README and configuration docs; verify the docs do not instruct users to edit `settings.json` or the upstream filename.

## 4. Repository verification and release readiness

- [ ] 4.1 Record a positive Changeset release intent for `@indexyz/pi-ask` and verify the release-impact gate recognizes the new package decision.
- [ ] 4.2 Run `npm run check` from the repository root and fix all format, lint, typecheck, build, and test failures.
- [ ] 4.3 Run the Pi RPC load smoke test and `npm run test:e2e -- --package @indexyz/pi-ask`; verify the extension loads and reports the `ask_user_question` tool without making a model call.

## Workflow follow-up

- Archive the completed `add-pi-ask` change after implementation and review.
