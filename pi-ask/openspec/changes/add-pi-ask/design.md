# Design

## Context

The upstream `eko24ive/pi-ask` extension already separates tool wiring, state transitions, configuration, and TUI rendering. This package will be maintained as a first-class `pi-ask/` workspace package and must follow this repository's npm, TypeScript, Vitest, OpenSpec, and Changesets conventions.

## Goals / Non-Goals

**Goals:**

- Preserve the upstream structured ask experience and its tested state/UI behavior.
- Register the public tool as `ask_user_question` everywhere, including persisted and recovery-related identifiers.
- Persist the package configuration under the user agent directory as `pi-ask.json`.
- Make the package loadable from this repository and from its published tarball.

**Non-Goals:**

- Do not add compatibility registration for the old `ask_user` tool name.
- Do not merge the configuration into Pi's general `settings.json`.
- Do not redesign the upstream ask UX or add unrelated repository-wide tooling.

## Decisions

1. **Fork the upstream module boundaries and behavior.** Copy the upstream TypeScript implementation, tests, contract documentation, and relevant skill/docs, then adapt only integration points required by this repository. This keeps state behavior testable and minimizes a risky UI rewrite; wrapping the npm package would prevent local maintenance.

2. **Use repository-native package layout.** Expose a root `index.ts`, use `.ts` imports, Vitest tests under `test/`, exact host dev dependency pins with wildcard peers, and an explicit `files` allowlist. This matches the packages that Pi loads directly.

3. **Rename the tool at the contract boundary and storage boundaries.** Change the registered tool name, tool descriptions, payload persistence/replay filters, recovery detection, event names where they encode the tool identity, and user-facing contract text from `ask_user` to `ask_user_question`. The old name is intentionally not registered.

4. **Use a dedicated configuration file.** Keep the upstream config schema, migrations, and live subscription model, but change the resolved user config filename to `pi-ask.json` under Pi's agent directory (respecting `PI_CODING_AGENT_DIR`). Writes must preserve unrelated files and invalid config files must remain untouched.

5. **Use the repository's release and verification workflow.** Add the package to root workspaces and the root Pi manifest, record a positive Changeset, and verify through package checks, Pi RPC loading, and the repository e2e loader.

## Risks / Trade-offs

- [Risk] Pi TUI or host types differ from the upstream pinned version → [Mitigation] typecheck against the repository's pinned host and run the real Pi loader smoke test.
- [Risk] A broad string replacement could alter unrelated prose or event semantics → [Mitigation] update identifiers deliberately and add tests for registration, replay/recovery, and persisted payload handling.
- [Risk] The upstream test suite assumes Node's test runner → [Mitigation] migrate tests to Vitest without replacing the real Pi host in integration paths.
- [Risk] A package this large increases future Pi upgrade cost → [Mitigation] retain pure state modules, document the upstream origin, and keep the package's host pin explicit.

## Migration Plan

New installations use `pi-ask.json` and the `ask_user_question` tool. Existing upstream configuration files and `ask_user` calls are not automatically migrated because the new package intentionally owns a distinct tool contract and configuration filename; document this in the package README and changelog.
