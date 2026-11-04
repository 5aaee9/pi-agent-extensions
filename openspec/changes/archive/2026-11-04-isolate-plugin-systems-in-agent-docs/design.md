# Design

## Context

See `proposal.md` for motivation. This change was first drafted against `b8c0c39`, then rebuilt on `b21d47c` after the Pi E2E suite and the archived release and dsh specs landed.

## Goals / Non-Goals

**Goals:**

- A task in one plugin system never needs the other's commands, prerequisites, or documents.
- An agent loads only the document its task needs, one link away from `AGENTS.md`.

**Non-Goals:**

- Changing CI or adding root scripts. `lint.yml` and `publish.yml` still run root `npm run check`, so one system's failure can still block the other's publication. The documents state this truthfully; changing it is a separate owner decision. `test:e2e --kind` and the workspace list in `scripts/e2e/pi/rehearse.ts` show how a split could work.
- Editing the generated `openspec-*` skills or `pi-ask/skills/ask-user`.

## Decisions

**Scope follows what changed.** One package verifies that package, and only tooling that reaches both systems uses root commands. The alternative, a `check:pi` / `check:dsh` script pair, would give one command per system but adds tooling the request did not ask for. `test:e2e --kind` and a documented `for d in pi-*/` loop cover a whole-system run.

**Tooling that serves only Pi is scoped to Pi.** `scripts/e2e/pi/`, `pi-host-rehearsal.yml`, and `node-pty` live at the root but never touch dsh, so a blanket "`scripts/` means repository-wide" rule would make their changes run dsh tests for no reason. `test:e2e:pi` is a Pi command, so it belongs to `docs/pi/README.md`, not the shared steps.

**Pi test rules go to the Pi document.** `2026-11-04-apply-test-value-rules-to-all-packages` then moved the test-value rule to `docs/conventions.md` for every package; only the exception for testing a package's own logic without a host stays here. "Three kinds of test" and "a test asserts behaviour that can break" were written and specified for Pi packages (`real-environment-testing`), and the dsh packages were a stated no-op of that work. Placing them in `docs/pi/README.md` keeps dsh's stricter contract unchanged instead of implying a loosening.

**Existing commands express the scope.** `npm run check --workspace`, `npm run test:e2e -- --package`, `npx oxfmt --check <dir>`, and `npx oxlint <dir>` already exist. A release uses `changeset version --ignore` with a shell-neutral loop, tested in zsh and bash with intents pending in both systems.

**The publication plan is the one step with no scoped form.** `scripts/release/plan.ts` builds, tests, and loads every version absent from npm, and scoping it means changing release tooling, which this change leaves alone. `docs/releases.md` therefore checks the other system for unpublished versions first and stops to ask, so the plan only runs across systems on request.

**Stable entry paths.** `docs/workflow.md`, `docs/conventions.md`, and `docs/releases.md` keep their paths and their "Verify" and "Tests" sections, because specs and test comments cite them. Only `docs/pi-reference.md` moves.

**Split `docs/releases.md` by task, moving text rather than shortening it.** The runbook is a fragile operation, so its exact procedures stay. Separating routine from recovery and first-release work lets an agent recording an intent skip the CI internals. The first-run `0.1.43` rows are removed: the generic failure rows already cover the case, and they guide no future action.

**One level of routing.** `AGENTS.md` links leaf documents directly (`docs/pi/new-package.md`), so no task needs a chain of documents to find its instructions.

**`pi-extension-dev` remains as a thin trigger.** Its description routes Pi work automatically, and its body now points at the documents instead of repeating them. No matching dsh skill is added; the `AGENTS.md` router covers dsh.

## Risks / Trade-offs

- A scoped local run can pass while CI fails on the other system. → The documents say to report it rather than fix it; removing the coupling is the CI decision above.
- A shared dependency change can move hoisted versions for the other system. → `docs/architecture.md` tells the agent to review the lockfile; the CI gate remains the backstop.
- Readers that remember numbered `AGENTS.md` rules lose those references. → Three test comments citing "rule 5" are updated; numbering is removed so it cannot go stale again.
