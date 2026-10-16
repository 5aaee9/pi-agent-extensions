# AGENTS.md

This repository is an npm workspace of extensions for [Pi](https://pi.dev), the coding agent. The root holds shared tooling and documentation only. Every extension is a self-contained Pi package in a root-level `pi-<topic>/` directory, published to npm as `@indexyz/pi-<topic>` and versioned on its own. This file and `docs/` are the contract agents work from.

## Before you start

- Read the document that matches your task from the index below, completely, before editing.
- Load the `pi-extension-dev` skill (`.agents/skills/pi-extension-dev/SKILL.md`) whenever you create, change, or debug an extension.
- Pi's API changes quickly. Answer every API question from the docs, examples, and type declarations of the Pi version the package you are editing pins (see `docs/pi-reference.md`), not from memory.

## Rules

1. The root contains no extension runtime code. Root config files, `scripts/`, and `.changeset/` are shared development and CI tooling; change them only for repository-wide concerns and never to work around one package's problem.
2. One directory, one package. `<name>/` (for example `pi-skill/`) must work on its own: `pi -e ./<name>/index.ts` loads it, and its `package.json` declares its own `pi` manifest, `files` allowlist, scripts, and dev dependencies next to its own `tsconfig.json` and `vitest.config.ts`. Its npm name is always `@indexyz/<name>`. The directory and the package OpenSpec root use `<name>`; release intents, `npm --workspace`, the registry, and tags use `@indexyz/<name>`; the commit scope is `<name>` without `pi-`.
3. Host-provided packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`) go in `peerDependencies` with range `"*"`, never in `dependencies`; the package pins the exact version it builds and tests against in its `devDependencies`. Pi supplies them at runtime; a bundled copy breaks its module mapping.
4. TypeScript is strict (each package's `tsconfig.json`); oxlint (`--deny-warnings`) and oxfmt check the whole repository (oxfmt skips only the generated `.claude/` and `.agents/skills/openspec-*` files). Fix the code, not the rule: no `@ts-ignore`, `@ts-expect-error`, or lint suppressions, and no loosening of shared or package config.
5. Work is done only when verified: `npm run check` passes and the extension loads (`docs/workflow.md`, "Verify"). Report what you ran, not what you assume.
6. Use npm exclusively: `package-lock.json` is the only lockfile, and `npm ci` is what CI runs. Do not introduce another package manager or lockfile.
7. Commits follow Conventional Commits. The scope is the package directory without `pi-` (`feat(skill): ...`, `fix(sub2api): ...`); release preparations use `release` and repository-wide changes use `repo`. Scopes carry no versioning meaning.
8. Keep each package's `README.md` and the package table in the root `README.md` in sync with the code.
9. Agent configuration has one shared surface: this file and `.agents/`. `.claude/` is the only harness-specific directory and holds only what `openspec init` generates. Do not add files for any other harness, and keep `CLAUDE.md` exactly `@AGENTS.md`.
10. Non-trivial work goes through OpenSpec (propose, apply, archive). Package-scoped changes and specs live in `<name>/openspec/`, repository-wide ones in the root `openspec/`. Run every `openspec` command with the matching directory as the working directory; the CLI uses the nearest root. See `docs/workflow.md`, "Plan with OpenSpec".
11. Releases follow `docs/releases.md`. Every change to a package's published content carries a release decision in the same change: a positive intent, or `none` with a reason, one intent file per package. Never edit versions or changelog version headings by hand. Preparing versions, pushing a preparation to `main`, merging a release pull request, and dispatching the publish workflow each need an explicit request for that action; a push to `main` that carries a new version publishes it without further approval.

## Commands

Run from the repository root.

| Command                                                    | Purpose                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm install`                                              | Install tooling and each package's pinned Pi host packages (needed for types, docs, and examples)          |
| `npm run check`                                            | Format check, lint, typecheck, package tests, and release-script tests; the gate before every commit       |
| `npm run format`                                           | Apply oxfmt formatting                                                                                     |
| `npm run lint` / `npm run lint:fix`                        | Run oxlint / apply its fixes                                                                               |
| `npm run typecheck` / `npm test` / `npm run test:scripts`  | Individual steps of `check`                                                                                |
| `npm run check --workspace @indexyz/<name>`                | One package's typecheck and tests (any package script works with `--workspace`)                            |
| `npm run change -- --patch @indexyz/<name> -m "<summary>"` | Record a release intent (`--minor`, `--major`; a `none` intent is written by hand, see `docs/releases.md`) |
| `npm run change:status`                                    | Show pending release intents and the versions they imply (local only)                                      |
| `npm run release:gate -- --base origin/main --head HEAD`   | Run the pull-request release-impact gate locally                                                           |
| `cd <name> && openspec <cmd>`                              | OpenSpec for one package (root `openspec` is for repository-wide changes)                                  |

## Index

| When you                                                                        | Read                   |
| ------------------------------------------------------------------------------- | ---------------------- |
| need the repository layout or the anatomy of a package                          | `docs/architecture.md` |
| write or review TypeScript, choose dependencies, design commands, events, or UI | `docs/conventions.md`  |
| create, change, verify, or remove an extension; plan with OpenSpec; upgrade Pi  | `docs/workflow.md`     |
| decide release impact, prepare a release, or report or recover a publication    | `docs/releases.md`     |
| look up Pi's API, examples, docs, or type declarations                          | `docs/pi-reference.md` |
