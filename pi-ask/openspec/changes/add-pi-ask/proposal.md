# Proposal

## Why

Pi currently lacks a repository-maintained, structured clarification flow for preference-sensitive decisions. This change adds a native `ask_user_question` tool based on `eko24ive/pi-ask`, adapted to this workspace's package, testing, and release conventions, so agents can ask questions without guessing and receive normalized answers.

## What Changes

- Add a new `pi-ask/` package published as `@indexyz/pi-ask`.
- Add the upstream ask flow with single-select, multi-select, preview, free-form answers, notes, review, replay, recovery, and non-interactive safeguards.
- **BREAKING** Rename the registered tool from `ask_user` to `ask_user_question` throughout schemas, persisted payloads, rendering, recovery, replay, and event contracts.
- Adapt dependencies, scripts, tests, documentation, workspace registration, Pi manifest, and Changeset release metadata to repository conventions.

## Capabilities

### New Capabilities

- `structured-questions`: Native interactive question flow, normalized answers, replay/recovery, and tool contract.
- `ask-configuration`: Persisted pi-ask behavior, keymaps, notifications, and extraction settings in `pi-ask.json`.

### Modified Capabilities

- None.

## Impact

- Adds a new Pi extension and workspace package with `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, and `typebox` host/type dependencies.
- Adds a new tool name, `ask_user_question`; callers using the upstream `ask_user` name are not compatible.
- Stores pi-ask configuration in `pi-ask.json` under Pi's agent directory (respecting `PI_CODING_AGENT_DIR`).
- Adds an optional OSC 7501 notification channel that reports a waiting question as a blocked program status.
- Adds root workspace and Pi manifest entries, package documentation, tests, and a positive release intent for `@indexyz/pi-ask`.
- Preserves the upstream MIT license and credits the upstream project.
