# Proposal

## Why

Pi and dsh are separate plugin systems, yet every verification path in the agent documents ends in root commands that span both: a Pi-only change is told to pass `npm run check`, which also needs dsh's `pnpm` and Chromium prerequisites, and a release consumes every system's intents by default. `AGENTS.md` also carries 10 KB of detail on every load, and `docs/releases.md` costs 43 KB to read for a task as small as recording an intent. Recent test work added Pi-only tooling and left `docs/` and the `agent-guidance` spec disagreeing with it.

## What Changes

- Add a plugin-system isolation rule: unless the user asks to cross systems, tests, builds, and releases cover only the system being worked on.
- Reduce `AGENTS.md` to identity, the isolation rule, the few always-applicable rules, and a task-to-document router. `CLAUDE.md` stays exactly `@AGENTS.md`, which already redirects. **BREAKING for readers:** the numbered rules and the command table are gone.
- Split system-specific documents out: `docs/pi/` (`README.md`, `new-package.md`, `reference.md`) and `docs/dsh/` (`README.md`, `new-package.md`). Pi's test rules, black-box scenarios, and upgrade rehearsal go to `docs/pi/README.md`.
- Keep `docs/workflow.md` and `docs/conventions.md` as the shared process and code rules, and move the shared rules of `AGENTS.md` there.
- Scope verification by what changed: one package, one system (`test:e2e --kind`), tooling only Pi uses (`scripts/e2e/pi/`, `pi-host-rehearsal.yml`, `node-pty`), or shared tooling.
- Split `docs/releases.md` by task: the routine stays, CI mechanics move to `docs/releases/ci.md`, and the first-release runbook to `docs/releases/first-release.md`. Their procedures move without being weakened.
- Replace root `npm run check` with scoped commands in the `pi-extension-dev` skill, the root `README.md`, the root `openspec/config.yaml` task rule, all 12 package `openspec/config.yaml` contexts, and six published package READMEs.
- Correct stale facts: package enumerations and counts, the fused step numbering in "Create a new extension", the missing registration step for a new Pi package, the workflow list and test-location claim in `docs/architecture.md`, the `tsconfig` claim in conventions, and the install lists in the root `README.md`. Remove release-history narrative from the runbook.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-guidance`: adds the isolation and progressive-disclosure requirements, and updates the requirements that pin the old `AGENTS.md` shape, document paths, skill procedure, and the ended `pi-provider-sub2api` deferral.
- `agent-release-workflow`: the release procedure spans three documents, and the first-run history is no longer required.

## Impact

- Repository-wide because it changes `AGENTS.md`, `docs/`, the shared skill, and every package's OpenSpec context. No package behavior changes.
- Release decisions: `none` for `@indexyz/pi-autocompact`, `@indexyz/pi-custom-provider`, `@indexyz/pi-provider-sub2api`, `@indexyz/dsh-thread-summary`, `@indexyz/dsh-autocompact`, and `@indexyz/dsh-custom-provider-reasoning-efforts`, whose READMEs change. All other package edits touch only `openspec/` or test comments, which need no decision.
- `docs/pi-reference.md` moves to `docs/pi/reference.md`. Archived changes keep citing the old layout and are not edited.
- CI stays repository-wide (see `design.md`).
