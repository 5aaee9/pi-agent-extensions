# Tasks

## 1. Restructure the documents

- [x] 1.1 Branch from `origin/main` and move the documents into the new structure, keeping everything `main` added since the first draft: the Pi test rules, the Pi E2E suite, `test:e2e --kind`, the upgrade rehearsal, and the live-endpoint boundary.
- [x] 1.2 Scope verification by what changed in `docs/workflow.md`, and add the Pi-only commands to `docs/pi/README.md`.
- [x] 1.3 Add the registration step to `docs/pi/new-package.md`, and correct the workflow list and test-location claim in `docs/architecture.md`.
- [x] 1.4 Update the skill, the root `README.md`, root and package `openspec/config.yaml`, code comments that cite moved sections, and the six published READMEs with their `none` intents.
- [x] 1.5 Delete the superseded `restructure.patch`, and update `audit-report.md`.

## 2. Confirm the surface

- [x] 2.1 Confirm `AGENTS.md` and every document it routes to exist, and that `CLAUDE.md` is exactly `@AGENTS.md`.
- [x] 2.2 Grep `AGENTS.md`, `docs/`, the skill, and all `openspec/config.yaml` files for `docs/pi-reference.md`, `AGENTS.md rule`, `releases.md#first-release`, `deferred`, and unscoped root `npm run check`, keeping only the shared-tooling and CI uses.

## 3. Verify

- [x] 3.1 Run the scoped commands in `docs/workflow.md` for `pi-skill` and `dsh-thread-summary`, `pi-skill`'s scenarios, `npm run test:scripts`, the root typecheck, and `npm run lint:tooling`. The owner ruled out further full runs for this documents change, so root `npm run check`, `npm run test:e2e`, and `npm run test:e2e:pi` are left to CI.
- [x] 3.2 Run the release commands in a scratch clone with intents pending in both systems.
- [x] 3.3 Run the release-impact gate against a scratch commit of the change.
- [x] 3.4 Validate this change with `npx openspec validate isolate-plugin-systems-in-agent-docs`.
