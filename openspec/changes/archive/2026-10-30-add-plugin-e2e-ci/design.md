# Design

## Context

Every package already verifies itself with `npm run check` (typecheck, build, tests) and, for dsh packages, a `release.smoke` script that the release engine runs against the packed and installed tarball. CI (`lint.yml`) runs `npm run check`, and `publish.yml` loads each uploading version at its version commit. Nothing exercises the whole discovered plugin set through its host on every change: a dsh plugin that fails to mount a service, or a Pi extension whose entry no longer registers, reaches `main` silently between releases. The repository now holds 6 Pi packages and 4 dsh packages, several pinning different host lines.

## Goals / Non-Goals

**Goals:** One repository-wide command that loads every supported workspace package in its real host, deterministic and offline, usable by CI and by hand; per-package diagnostics; repository documentation and CI integration.

**Non-Goals:** Changing any plugin runtime code, manifest, or published content; running model or business API calls; replacing `npm run check`, the release gate, or `publish.yml` loading; versioning or publishing anything.

## Decisions

- One runner entry `scripts/e2e/plugins.ts` plus a shared `scripts/e2e/runtime.ts`, run through Node's built-in type stripping via the root `test:e2e` script (rule 4: tooling is `.ts` and erasable-only). No new dependencies and no new lockfile.
- Discovery comes from the root `package.json` `workspaces` list read against each workspace's `package.json`: a `pi` manifest means Pi loading (its `pi.extensions` must be non-empty), a `dsh` manifest means packaging loading (its `release.smoke` must be a relative `.ts` path), both together is an error, and neither means skip (private workspace roots and tooling). Packages sort deterministically by npm name so CI output is stable.
- Pi loading reuses the installed Pi binary (`<pkg>/node_modules/.bin/pi`, falling back to the root one), `--mode rpc` with `--no-session`, an isolated `--session-dir`, an empty `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`, `--offline`, `--approve`, `--no-builtin-tools`, and `--no-skills`/`--no-prompt-templates`/`--no-themes`/`--no-context-files` so the run cannot pick up machine state; success requires exit 0 plus a `{"type":"response","command":"get_commands","success":true}` line.
- DSH loading follows the release engine's isolation without touching live profiles: `npm run build`, `npm pack --ignore-scripts` into a temporary directory, `npm install --ignore-scripts --omit=peer --legacy-peer-deps` of the produced tarball into an empty prefix, then the package's declared `release.smoke` run against the installed copy. `--legacy-peer-deps` matches `docs/releases.md` for packages declaring a `dsh` manifest; peers are not re-resolved, only loaded as declared.
- Temporary roots come from `mkdtempSync` under `tmpdir()` and are removed in a `finally`, so an interrupted run leaves no artifacts; the runner adds nothing under the repository and generated `lib/`/`client.js` stay Git-ignored.
- Bounded execution: one 120-second default per package (`--timeout-ms` locally), captured and truncated stdout/stderr, and failure aggregation — a failed package is reported with its command, status, and output, the run continues, and the process exits non-zero only after printing the total/passed/failed summary. One failure never hides the remaining packages.
- Local filters `--package <npm-name>` keep the default full-discovery behavior untouched so CI never passes filters.
- The CI quality workflow gains one step after `npm run check`, and `docs/workflow.md` documents the command, its offline guarantees, discovery rules, and diagnostics.

## Risks / Trade-offs

- The runner shells out to hosts and npm, so it is slower than unit tests; it is a separate CI step after `check`, keeping the fast gate first.
- Loading proves activation and registration observable to the host, not feature behavior; package tests stay responsible for behavior.
- Pi packages that pin older Pi lines are loaded with their package-local binary; a package without a resolvable binary fails with an actionable message rather than being skipped.
- Discovery trusts the manifests; a package with neither manifest stays out of scope, matching the repository contract.

## Migration Plan

Land the runner, wire the script and the CI step, document it, then run `npm run check` and `npm run test:e2e` from the root to prove the full set loads. Archive this change and sync its capability into the root specs. Reverting only removes the gate and documentation; no package state changes.
