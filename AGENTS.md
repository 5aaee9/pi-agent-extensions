# AGENTS.md

This repository is an npm workspace of agent extensions. The root holds shared tooling and documentation only. Most packages extend [Pi](https://pi.dev): a self-contained Pi extension in a root-level `pi-<topic>/` directory, published to npm as `@indexyz/pi-<topic>` and versioned on its own. A root-level `dsh-<topic>/` directory instead extends [dsh](https://github.com/deepseek-ai/deepseek-harness), the DeepSeek Harness, published as `@indexyz/dsh-<topic>` under the same release rules and with the differences rule 2 names. This file and `docs/` are the contract agents work from.

## Before you start

- Read the document that matches your task from the index below, completely, before editing.
- Load the `pi-extension-dev` skill (`.agents/skills/pi-extension-dev/SKILL.md`) whenever you create, change, or debug a `pi-<topic>/` package. A `dsh-<topic>/` package is a Cordis plugin for the Harness instead: answer its API questions from the Harness installation that package pins, exactly as `docs/pi-reference.md` tells you to answer Pi's for a pi package.
- Pi's API changes quickly. Answer every API question from the docs, examples, and type declarations of the Pi version the package you are editing pins (see `docs/pi-reference.md`), not from memory.

## Rules

1. The root contains no extension runtime code. Root config files, `scripts/`, and `.changeset/` are shared development and CI tooling; change them only for repository-wide concerns and never to work around one package's problem.
2. One directory, one package. `<name>/` must work on its own: a `pi-<topic>/` package loads with `pi -e ./<name>/index.ts`, and a `dsh-<topic>/` package installs into a dsh profile from its own directory. Its `package.json` declares its own manifest, `files` allowlist, scripts, and dev dependencies next to its own `tsconfig.json` and `vitest.config.ts`. Its npm name is always `@indexyz/<name>`. The directory and the package OpenSpec root use `<name>`; release intents, `npm --workspace`, the registry, and tags use `@indexyz/<name>`; the commit scope is `<name>` without `pi-` or `dsh-`.
   - A `pi-` package declares the `pi` manifest and ships TypeScript sources Pi loads directly, so it has no build.
   - A `dsh-` package declares the `dsh` manifest instead, and no `pi` manifest. The Harness loads built files, so it compiles its host half into `lib/` and bundles its browser half into a single `client.js`, both by its own scripts, and commits those artifacts because a local `link:` install consumes them; the root oxfmt and oxlint configs ignore those generated paths. It is verified from its packed tarball by the script its manifest declares (rule 5).
3. Host-provided packages go in `peerDependencies` with range `"*"`, never in `dependencies`; the package pins the exact version it builds and tests against in its `devDependencies`. For a pi package those hosts are `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` (see `docs/pi-reference.md`); for a dsh package they are the `@deepseek-ai/dsh-*` packages and `@deepseek-ai/schemastery` it builds against. The host supplies them at runtime; a bundled copy breaks its module mapping.
4. All code is TypeScript (`.ts`): extensions, tests, and repository tooling alike. Never add `.js`, `.mjs`, or `.cjs` source files — a dsh package's committed `client.js` and `lib/` are build output, not sources, and are never edited by hand; tooling runs as `.ts` through Node's built-in type stripping (`node scripts/release/<name>.ts`), so use only erasable syntax and `.ts` import extensions. Type checking and linting are as strict as the tools allow: each package's `tsconfig.json` is strict, the root `tsconfig.json` enables every strictness option for `scripts/` and `.changeset/`, and `.oxlintrc.tooling.json` adds type-aware, `suspicious`, `pedantic`, and `perf` rules there on top of the repository-wide oxlint (`--deny-warnings`) and oxfmt checks (oxfmt skips only the generated `.agents/skills/openspec-*` files). New code meets the strictest configuration that applies to it. Fix the code, not the rule: no `@ts-ignore`, `@ts-expect-error`, or lint suppressions, and no loosening of shared or package config.
5. Work is done only when verified: `npm run check` passes and the package loads in its host (`docs/workflow.md`, "Verify"). A pi package loads with `pi -e`; a dsh package declares `release.smoke`, a `.ts` script the release engine runs against the packed and installed tarball because Pi cannot load it (`docs/releases.md`, "Packages Pi does not load"), and the same script is what a hand verification runs. Report what you ran, not what you assume.
6. Use npm exclusively: `package-lock.json` is the only lockfile, and `npm ci` is what CI runs. Do not introduce another package manager or lockfile.
7. Commits follow Conventional Commits. The scope is the package directory without its prefix (`feat(skill): ...` for `pi-skill`, `fix(autocompact): ...` for `dsh-autocompact`; spell it out when two packages would share the scope); release preparations use `release` and repository-wide changes use `repo`. Scopes carry no versioning meaning.
8. Keep each package's `README.md` and the package table in the root `README.md` in sync with the code.
9. Agent configuration has one shared surface: this file and `.agents/`. `.claude` is a symlink to `.agents` (so Claude Code reads the same skills) and never a directory of its own. Do not add files for any harness outside `.agents/`, and keep `CLAUDE.md` exactly `@AGENTS.md`.
10. Non-trivial work goes through OpenSpec (propose, apply, archive). Package-scoped changes and specs live in `<name>/openspec/`, repository-wide ones in the root `openspec/`. Run every `openspec` command with the matching directory as the working directory; the CLI uses the nearest root. See `docs/workflow.md`, "Plan with OpenSpec".
11. Releases follow `docs/releases.md`. Every change to a package's published content carries a release decision in the same change: a positive intent, or `none` with a reason, one intent file per package. Never edit versions or changelog version headings by hand. Preparing versions, pushing a preparation to `main`, merging a release pull request, and dispatching the publish workflow each need an explicit request for that action; a push to `main` that carries a new version publishes it without further approval. Every new npm package follows the runbook's [first-release procedure](docs/releases.md#first-release-of-a-new-package): prepare an independent empty `0.0.0` workspace outside the repository, have the owner publish it with the `bootstrap` tag and configure npm Trusted Publisher, then push the verified formal version to GitHub once the owner confirms setup is complete. Agents may prepare and commit locally while waiting; an already-authorized conditional push needs no second approval.

## Commands

Run from the repository root.

| Command                                                    | Purpose                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                              | Install tooling and each package's pinned Pi host packages (needed for types, docs, and examples)                                  |
| `npm run check`                                            | Format check, lint, typecheck, each package's build, package tests, and release-script tests; the gate before every commit         |
| `npm run format`                                           | Apply oxfmt formatting                                                                                                             |
| `npm run lint` / `npm run lint:fix`                        | Run oxlint, including the strict type-aware profile for `scripts/` and `.changeset/` / apply its fixes                             |
| `npm run typecheck` / `npm run build` / `npm test`         | Individual steps of `check` (`typecheck` covers the root tooling and every package; `build` skips packages without a build script) |
| `npm run test:scripts`                                     | Individual step of `check`: the release-script tests                                                                               |
| `npm run check --workspace @indexyz/<name>`                | One package's typecheck, build, and tests (any package script works with `--workspace`)                                            |
| `npm run change -- --patch @indexyz/<name> -m "<summary>"` | Record a release intent (`--minor`, `--major`; a `none` intent is written by hand, see `docs/releases.md`)                         |
| `npm run change:status`                                    | Show pending release intents and the versions they imply (local only)                                                              |
| `npm run release:gate -- --base origin/main --head HEAD`   | Run the pull-request release-impact gate locally                                                                                   |
| `cd <name> && openspec <cmd>`                              | OpenSpec for one package (root `openspec` is for repository-wide changes)                                                          |

## Index

| When you                                                                        | Read                   |
| ------------------------------------------------------------------------------- | ---------------------- |
| need the repository layout or the anatomy of a package                          | `docs/architecture.md` |
| write or review TypeScript, choose dependencies, design commands, events, or UI | `docs/conventions.md`  |
| create, change, verify, or remove an extension; plan with OpenSpec; upgrade Pi  | `docs/workflow.md`     |
| decide release impact, prepare a release, or report or recover a publication    | `docs/releases.md`     |
| look up Pi's API, examples, docs, or type declarations                          | `docs/pi-reference.md` |
