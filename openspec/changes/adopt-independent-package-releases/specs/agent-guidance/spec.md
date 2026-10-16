# Spec Delta

## Purpose

Define the agent instruction surface of this repository so that any coding agent finds the same rules, commands, documentation index, and OpenSpec layout, and so that those documents stay true to how this npm workspace is built and checked.

## ADDED Requirements

### Requirement: One shared instruction surface

`AGENTS.md` at the repository root SHALL hold the rules, command table, and documentation index for agents. `CLAUDE.md` SHALL contain exactly `@AGENTS.md`. `.agents/` SHALL hold shared skills, and `.claude/` SHALL be the only harness-specific directory, limited to OpenSpec-generated commands and skills. No other harness SHALL get its own instruction files.

#### Scenario: Claude Code session
- **WHEN** Claude Code loads the repository
- **THEN** it reads `AGENTS.md` through `CLAUDE.md` and finds no conflicting instructions elsewhere

#### Scenario: Codex session
- **WHEN** an agent that reads `AGENTS.md` and `.agents/skills/` starts
- **THEN** it finds the same rules and the `pi-extension-dev` and OpenSpec skills

### Requirement: Documentation describes this repository truthfully

`docs/architecture.md`, `docs/conventions.md`, `docs/workflow.md`, `docs/releases.md`, and `docs/pi-reference.md` SHALL describe this repository as it is: npm workspaces with `package-lock.json`, root-level `pi-*/` package directories, oxlint and oxfmt, per-package `tsconfig.json`, `vitest.config.ts`, and dev dependencies, host packages as `"*"` peer dependencies, the `@indexyz` scope, and the `main` branch. Every command in the `AGENTS.md` command table and in the docs SHALL run as written from the repository root (or the stated directory).

#### Scenario: Commands run as documented
- **WHEN** an agent runs each command listed in `AGENTS.md`
- **THEN** each runs without "missing script" or "unknown option" errors

#### Scenario: No pnpm or Biome instructions
- **WHEN** the docs are searched for `pnpm`, `biome`, or `packages/<name>`
- **THEN** no instruction tells the agent to use them in this repository

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

The root `README.md` SHALL list every package with its npm name and description, explain that packages are released independently with tags `@indexyz/<name>@<version>`, and point to `AGENTS.md` and `docs/`. Each package `README.md` SHALL state its install command, its tag format, and how to try it from a checkout. No README SHALL describe a shared version or the `v*` tag.

#### Scenario: Root README after the change
- **WHEN** the root README is read
- **THEN** it has no "all packages share one version" statement and names the per-package tag format
