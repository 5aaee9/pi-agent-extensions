# agent-guidance Specification

## Purpose

Define what the shared agent instruction surface (`AGENTS.md`, `docs/`) must tell an agent, so that following the documents alone produces package work that meets the repository's contracts — today, the real-environment testing contract and the boundaries it records.

## Requirements

### Requirement: The instruction surface requires real-environment testing

`docs/conventions.md` (Tests section) SHALL state that every package test exercises the host plane the package pins — the real host packages, services, loaders, DOM, and HTTP clients — and SHALL NOT replace a host package, service, loader, DOM, or HTTP client with a stand-in for the duration of the test.

#### Scenario: An agent writes a new package test

- **WHEN** an agent follows `docs/conventions.md` to add a test to any package
- **THEN** the rules route it to drive the pinned host plane, and no instruction invites a fake or a module replacement of a host package

#### Scenario: The old thin-index contract is gone

- **WHEN** `docs/conventions.md` is searched for the claim that logic must be testable without a running host
- **THEN** that claim no longer stands as the testing contract

### Requirement: Verification docs record the testing boundaries

`docs/workflow.md` (Verify) SHALL state that a package's verification runs through its host, and SHALL record two boundaries explicitly: which package's live-endpoint tests are deferred by owner decision, and that credential-gated model paths are recorded as blocked when their credential route is undecided. `AGENTS.md` rule 5 SHALL keep pointing at that documentation rather than restating the mock policy.

#### Scenario: A deferred package is discoverable

- **WHEN** an agent reads `docs/workflow.md` before touching `pi-provider-sub2api`
- **THEN** it finds that that package's live-endpoint tests are currently deferred by owner decision, and it must not convert them silently or fake them

#### Scenario: The rule pointer stays stable

- **WHEN** `AGENTS.md` rule 5 is read
- **THEN** it still points at `docs/workflow.md` and `docs/conventions.md` for the testing requirement, and does not itself carry a list of banned test constructs

### Requirement: One shared instruction surface

`AGENTS.md` at the repository root SHALL hold the rules, command table, and documentation index for agents. `CLAUDE.md` SHALL contain exactly `@AGENTS.md`. `.agents/` SHALL hold the shared skills, and `.claude` SHALL be a symlink to `.agents` rather than a directory of its own, so Claude Code reads the same skills. No harness SHALL get instruction files of its own.

#### Scenario: Claude Code session

- **WHEN** Claude Code loads the repository
- **THEN** it reads `AGENTS.md` through `CLAUDE.md`, finds the shared skills through the `.claude` symlink, and finds no conflicting instructions elsewhere

#### Scenario: Codex session

- **WHEN** an agent that reads `AGENTS.md` and `.agents/skills/` starts
- **THEN** it finds the same rules and the `pi-extension-dev` and OpenSpec skills

### Requirement: Repository code is strict TypeScript

Every source, test, and tooling file in the repository SHALL be TypeScript (`.ts`); no `.js`, `.mjs`, or `.cjs` source files SHALL be added. Repository tooling SHALL run directly through Node's type stripping and SHALL be checked as strictly as the tools allow: a root `tsconfig.json` with every strictness option for `scripts/` and `.changeset/`, and a type-aware oxlint profile with the `correctness`, `suspicious`, `pedantic`, and `perf` categories plus strict typing rules, both part of `npm run check`. `AGENTS.md` and `docs/conventions.md` SHALL state the rule.

#### Scenario: No JavaScript modules

- **WHEN** the tracked files are listed with `git ls-files '*.js' '*.mjs' '*.cjs'`
- **THEN** none are listed

#### Scenario: Strict checks are part of the gate

- **WHEN** `npm run check` runs
- **THEN** it typechecks `scripts/` and `.changeset/` with the root `tsconfig.json` and lints them with the strict type-aware profile, and any finding fails it

### Requirement: Documentation describes this repository truthfully

`docs/architecture.md`, `docs/conventions.md`, `docs/workflow.md`, `docs/releases.md`, and `docs/pi-reference.md` SHALL describe this repository as it is: npm workspaces with `package-lock.json`, root-level `pi-*/` and `dsh-*/` package directories, oxlint and oxfmt, per-package `tsconfig.json`, `vitest.config.ts`, and dev dependencies, host packages as `"*"` peer dependencies, the `@indexyz` scope, and the `main` branch. Every command in the `AGENTS.md` command table and in the docs SHALL run as written from the repository root (or the stated directory).

#### Scenario: Commands run as documented

- **WHEN** an agent runs each command listed in `AGENTS.md`
- **THEN** each runs without "missing script" or "unknown option" errors

#### Scenario: No pnpm or Biome instructions

- **WHEN** the docs are searched for `pnpm`, `biome`, or `packages/<name>`
- **THEN** no instruction tells the agent to use them as this repository's package manager, formatter, or linter, or to place a package under `packages/<name>`; `pnpm` appears only as the tool the pinned dsh host's plugin manager needs

### Requirement: The extension-development skill ties the docs together

`.agents/skills/pi-extension-dev/SKILL.md` SHALL give the procedure for creating, changing, verifying, and recording the release decision of an extension here, pointing to `docs/` for the rules, and SHALL direct agents to answer Pi API questions from the installed `@earendil-works/pi-coding-agent` package of the package being edited, not from memory.

#### Scenario: Changing an extension

- **WHEN** an agent loads the skill to change `pi-autocompact`
- **THEN** the skill leads it through reading the package docs and specs, implementing with tests, running `npm run check`, loading the extension with `pi -e ./pi-autocompact/index.ts`, and recording an intent for `@indexyz/pi-autocompact`

### Requirement: Two-level OpenSpec roots

The root `openspec/` SHALL be used for repository-wide changes only, with its `config.yaml` stating that scope and the verification rules. Each package SHALL have its own OpenSpec root at `<name>/openspec/` for changes and specs about that package, excluded from the package's published `files`. Documentation SHALL tell agents to run `openspec` from the package directory for package work.

#### Scenario: Package change from the package directory

- **WHEN** an agent runs `openspec context --json` inside `pi-skill/`
- **THEN** the resolved root is `pi-skill/openspec`

#### Scenario: Package roots are not published

- **WHEN** `npm pack --workspace @indexyz/pi-skill --dry-run` runs
- **THEN** the tarball contains no `openspec/` entry

### Requirement: READMEs reflect independent releases

The root `README.md` SHALL list every package with its npm name and description, explain that packages are released independently with tags `@indexyz/<name>@<version>`, and point to `AGENTS.md` and `docs/`. Each package `README.md` SHALL state its install command and how to try it from a checkout, and each `pi-*` package `README.md` SHALL also state its tag format. No README SHALL describe a shared version or the `v*` tag.

#### Scenario: Root README after the change

- **WHEN** the root README is read
- **THEN** it has no "all packages share one version" statement and names the per-package tag format

### Requirement: The instruction surface describes both package classes

`AGENTS.md` SHALL state the package rules for both root-level prefixes: one directory, one package, named `@indexyz/<dir>`; a `pi-<topic>/` package declares its own `pi` manifest and `pi.extensions` entry and is loaded by Pi from TypeScript sources, while a `dsh-<topic>/` package declares a `dsh` manifest, no `pi` manifest, and ships built artifacts (`lib/`, `client.js`); both treat their host packages (`@earendil-works/*` for Pi, `@deepseek-ai/*` for dsh) as exact `devDependencies` pins with `"*"` in `peerDependencies`; the root `check` builds every package that declares a `build` script; and every rule that states the Conventional Commit scope states it for both classes (the directory name without its `pi-` or `dsh-` prefix). `docs/architecture.md` SHALL list the second class in its layout, its package anatomy, and its manifest and loading sections. `docs/workflow.md` SHALL give the procedure for creating a `dsh-<topic>/` package and for verifying one. The root `README.md` SHALL list the package in its table, and `openspec/config.yaml` SHALL describe the two package classes. No document SHALL claim that Pi loads a dsh package, that the Harness loads a `pi-*` package, or that every package has no build step.

#### Scenario: An agent adds the next dsh package

- **WHEN** an agent follows `docs/workflow.md` to create a `dsh-<topic>/` package
- **THEN** it finds the directory and naming rules, the `dsh` manifest, the build scripts, the `files` and `release.smoke` requirements, the package OpenSpec root, the root `workspaces` entry, the README row, and the release decision step without consulting the engine's source

#### Scenario: No false statement about loading or building

- **WHEN** `AGENTS.md` and `docs/` are searched for statements about how a package is loaded
- **THEN** no statement says a dsh package is loaded by Pi or that the repository has no build step

#### Scenario: The root context counts both classes

- **WHEN** `openspec/config.yaml` is read
- **THEN** its repository description states the packages in root-level `pi-*/` and `dsh-*/` directories, published independently as `@indexyz/<name>`, with the dsh packages built
