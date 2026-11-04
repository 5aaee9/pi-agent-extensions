# agent-guidance Specification

## Purpose

Define what the shared agent instruction surface (`AGENTS.md`, `docs/`) must tell an agent, so that following the documents alone produces package work that meets the repository's contracts — today, the real-environment testing contract and the boundaries it records.

## Requirements

### Requirement: The instruction surface requires real-environment testing

`docs/conventions.md` (Tests section) SHALL state that a package test that drives a host exercises the host plane the package pins — the real host packages, services, loaders, DOM, and HTTP clients — and SHALL NOT replace a host package, service, loader, DOM, or HTTP client with a stand-in for the duration of the test. `docs/pi/README.md` (Tests section) SHALL state what a Pi package may test without a running host, consistently with `real-environment-testing`.

#### Scenario: An agent writes a new package test

- **WHEN** an agent follows `docs/conventions.md` and its system's document to add a test to any package
- **THEN** the rules route it to drive the pinned host plane wherever behaviour depends on the host, and no instruction invites a fake or a module replacement of a host package

#### Scenario: The old thin-index contract is gone

- **WHEN** `docs/conventions.md` is searched for the claim that logic must be testable without a running host
- **THEN** that claim no longer stands as the testing contract

### Requirement: One shared instruction surface

`AGENTS.md` at the repository root SHALL hold the rules that apply to every task and the router to the documents. `CLAUDE.md` SHALL contain exactly `@AGENTS.md`. `.agents/` SHALL hold the shared skills, and `.claude` SHALL be a symlink to `.agents` rather than a directory of its own, so Claude Code reads the same skills. No harness SHALL get instruction files of its own.

#### Scenario: Claude Code session

- **WHEN** Claude Code loads the repository
- **THEN** it reads `AGENTS.md` through `CLAUDE.md`, finds the shared skills through the `.claude` symlink, and finds no conflicting instructions elsewhere

#### Scenario: Codex session

- **WHEN** an agent that reads `AGENTS.md` and `.agents/skills/` starts
- **THEN** it finds the same rules and the `pi-extension-dev` and OpenSpec skills

### Requirement: Repository code is strict TypeScript

Every source, test, and tooling file in the repository SHALL be TypeScript (`.ts`); no `.js`, `.mjs`, or `.cjs` source files SHALL be added. Repository tooling SHALL run directly through Node's type stripping and SHALL be checked as strictly as the tools allow: a root `tsconfig.json` with every strictness option for `scripts/` and `.changeset/`, and a type-aware oxlint profile with the `correctness`, `suspicious`, `pedantic`, and `perf` categories plus strict typing rules, both part of `npm run check`. `docs/conventions.md` SHALL state the rule.

#### Scenario: No JavaScript modules

- **WHEN** the tracked files are listed with `git ls-files '*.js' '*.mjs' '*.cjs'`
- **THEN** none are listed

#### Scenario: Strict checks are part of the gate

- **WHEN** `npm run check` runs
- **THEN** it typechecks `scripts/` and `.changeset/` with the root `tsconfig.json` and lints them with the strict type-aware profile, and any finding fails it

### Requirement: Documentation describes this repository truthfully

The documents under `docs/` SHALL describe this repository as it is: npm workspaces with `package-lock.json`, root-level `pi-*/` and `dsh-*/` package directories, oxlint and oxfmt, per-package `tsconfig.json`, `vitest.config.ts`, and dev dependencies, host packages as `"*"` peer dependencies, the `@indexyz` scope, and the `main` branch. Every command in `AGENTS.md` and in the docs SHALL run as written from the repository root (or the stated directory).

#### Scenario: Commands run as documented

- **WHEN** an agent runs each command named in `AGENTS.md`
- **THEN** each runs without "missing script" or "unknown option" errors

#### Scenario: No pnpm or Biome instructions

- **WHEN** the docs are searched for `pnpm`, `biome`, or `packages/<name>`
- **THEN** no instruction tells the agent to use them as this repository's package manager, formatter, or linter, or to place a package under `packages/<name>`; `pnpm` appears only as the tool the pinned dsh host's plugin manager needs

### Requirement: The extension-development skill ties the docs together

`.agents/skills/pi-extension-dev/SKILL.md` SHALL route an agent that creates, changes, verifies, or records the release decision of a Pi extension to the documents that hold each procedure, and SHALL direct agents to answer Pi API questions from the installed `@earendil-works/pi-coding-agent` package of the package being edited, not from memory.

#### Scenario: Changing an extension

- **WHEN** an agent loads the skill to change `pi-autocompact`
- **THEN** the skill leads it to the documents for reading the package docs and specs, implementing with tests, verifying only Pi, and recording an intent for `@indexyz/pi-autocompact`

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

`docs/conventions.md` SHALL state the rules both classes share: one directory, one package, named `@indexyz/<dir>`; host packages as exact `devDependencies` pins with `"*"` in `peerDependencies`; and a Conventional Commit scope that is the directory name without its `pi-` or `dsh-` prefix. `docs/pi/README.md` SHALL state that a `pi-<topic>/` package declares its own `pi` manifest and `pi.extensions` entry, is loaded by Pi from TypeScript sources, and has `@earendil-works/*` hosts. `docs/dsh/README.md` SHALL state that a `dsh-<topic>/` package declares a `dsh` manifest, no `pi` manifest, ships built artifacts (`lib/`, `client.js`), and has `@deepseek-ai/*` hosts. `docs/architecture.md` SHALL list both classes in its layout. `docs/dsh/new-package.md` SHALL give the procedure for creating a `dsh-<topic>/` package and `docs/dsh/README.md` for verifying one. The root `README.md` SHALL list the package in its table, and `openspec/config.yaml` SHALL describe the two package classes. No document SHALL claim that Pi loads a dsh package, that the Harness loads a `pi-*` package, or that every package has no build step.

#### Scenario: An agent adds the next dsh package

- **WHEN** an agent follows `docs/dsh/new-package.md` to create a `dsh-<topic>/` package
- **THEN** it finds the directory and naming rules, the `dsh` manifest, the build scripts, the `files` and `release.smoke` requirements, the package OpenSpec root, the root `workspaces` entry, the README row, and the release decision step without consulting the engine's source

#### Scenario: An agent adds the next Pi package

- **WHEN** an agent follows `docs/pi/new-package.md` to create a `pi-<topic>/` package
- **THEN** it finds the templates, the root `workspaces` and `pi.extensions` entries, the registration entry the Pi suite requires, and the release decision step

#### Scenario: No false statement about loading or building

- **WHEN** `AGENTS.md` and `docs/` are searched for statements about how a package is loaded
- **THEN** no statement says a dsh package is loaded by Pi or that the repository has no build step

#### Scenario: The root context counts both classes

- **WHEN** `openspec/config.yaml` is read
- **THEN** its repository description states the packages in root-level `pi-*/` and `dsh-*/` directories, published independently as `@indexyz/<name>`, with the dsh packages built

### Requirement: The instruction surface keeps the plugin systems apart

`AGENTS.md` SHALL state that Pi and dsh are separate plugin systems and that, unless the user explicitly asks to cross them, an agent changes, builds, tests, and releases only the system it is working on and reports a failure in the other instead of fixing it. The documents SHALL give a scoped command for each verification and release step, and SHALL reserve root commands that span both systems for shared root tooling or an explicit request. The publication plan has no package filter, so the runbook SHALL confirm the other system has no unpublished version before running it.

#### Scenario: An agent verifies a Pi package

- **WHEN** an agent follows the documents to verify a change to one `pi-<topic>/` package
- **THEN** every command it is told to run covers only Pi packages and needs no dsh prerequisite

#### Scenario: An agent verifies a dsh package

- **WHEN** an agent follows the documents to verify a change to one `dsh-<topic>/` package
- **THEN** no command it is told to run loads, tests, or builds a Pi package, and the Pi scenario suite is not among them

#### Scenario: An agent prepares a release of one system

- **WHEN** an agent follows `docs/releases.md` to prepare a dsh release while Pi intents are pending
- **THEN** the documented command consumes only `dsh-*` intents and leaves every Pi package and intent unchanged

#### Scenario: The other system has an unpublished version

- **WHEN** an agent reaches the dry-run plan while a version of the other system is absent from npm
- **THEN** the runbook tells it to stop and ask before running the plan

#### Scenario: A change to shared tooling

- **WHEN** an agent changes root tooling that serves both systems, such as `scripts/release/`, root configuration, `lint.yml`, or `publish.yml`
- **THEN** the documents route it to root `npm run check`, `npm run test:e2e`, and `npm run test:e2e:pi`

#### Scenario: A change to tooling only Pi uses

- **WHEN** an agent changes `scripts/e2e/pi/`, `pi-host-rehearsal.yml`, or the root `node-pty` dependency
- **THEN** the documents route it to the Pi suite and the root tooling checks, with no dsh package built or tested

### Requirement: The instruction surface discloses detail progressively

`AGENTS.md` SHALL hold only what applies to every task, plus a router from each kind of task to the document that covers it. Detail specific to one plugin system SHALL live under that system's document directory, and shared documents SHALL link it rather than restate it.

#### Scenario: An agent starts a dsh task

- **WHEN** an agent reads `AGENTS.md` before changing a `dsh-<topic>/` package
- **THEN** the router sends it to the dsh document, and following it requires no Pi document

#### Scenario: An agent records a release decision

- **WHEN** an agent only needs to record a release decision
- **THEN** the document it is routed to covers that task without requiring it to read the CI mechanics or the first-release runbook

### Requirement: Verification docs record the live-endpoint and credential boundaries

`docs/workflow.md` (Verify) SHALL state that a package's verification runs through its host, and SHALL record two boundaries explicitly: that live endpoints stay untested for the provider packages, with no test standing in for a live reply, and that credential-gated model paths are recorded as pending when their credential route is undecided. `AGENTS.md` SHALL point at that documentation for verification rather than restating the mock policy.

#### Scenario: The live-endpoint boundary is discoverable

- **WHEN** an agent reads `docs/workflow.md` before touching `pi-provider-sub2api`
- **THEN** it finds that the package is exercised against a local relay, that its live endpoints stay untested, and that nothing fakes them into passing

#### Scenario: The rule pointer stays stable

- **WHEN** `AGENTS.md` is read for what verification requires
- **THEN** it points at `docs/workflow.md` for the testing requirement, and does not itself carry a list of banned test constructs
