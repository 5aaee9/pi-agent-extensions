# Spec Delta

## Purpose

Keep this repository's agent instruction surface true once it holds two kinds of package — Pi extensions in `pi-<topic>/` and dsh (DeepSeek Harness) plugins in `dsh-<topic>/` — so that any coding agent finds the same rules, commands, documentation index, and OpenSpec layout for each kind, and can add the next package of either kind without reading the release engine.

## ADDED Requirements

### Requirement: The instruction surface describes both package classes

`AGENTS.md` SHALL state the package rules for both root-level prefixes: one directory, one package, named `@indexyz/<dir>`; a `pi-<topic>/` package declares its own `pi` manifest and `pi.extensions` entry and is loaded by Pi from TypeScript sources, while a `dsh-<topic>/` package declares a `dsh` manifest, no `pi` manifest, and ships built artifacts (`lib/`, `client.js`); both treat their host packages (`@earendil-works/*` for Pi, `@deepseek-ai/*` for dsh) as exact `devDependencies` pins with `"*"` in `peerDependencies`; the root `check` builds every package that declares a `build` script; and every rule that states the Conventional Commit scope states it for both classes (the directory name without its `pi-` or `dsh-` prefix). `docs/architecture.md` SHALL list the second class in its layout, its package anatomy, and its manifest and loading sections. `docs/workflow.md` SHALL give the procedure for creating a `dsh-<topic>/` package and for verifying one. The root `README.md` SHALL list the package in its table, and `openspec/config.yaml` SHALL describe seven packages in two classes. No document SHALL claim that Pi loads a dsh package, that the Harness loads a `pi-*` package, or that every package has no build step.

#### Scenario: An agent adds the next dsh package

- **WHEN** an agent follows `docs/workflow.md` to create a `dsh-<topic>/` package
- **THEN** it finds the directory and naming rules, the `dsh` manifest, the build scripts, the `files` and `release.smoke` requirements, the package OpenSpec root, the root `workspaces` entry, the README row, and the release decision step without consulting the engine's source

#### Scenario: No false statement about loading or building

- **WHEN** `AGENTS.md` and `docs/` are searched for statements about how a package is loaded
- **THEN** no statement says a dsh package is loaded by Pi or that the repository has no build step

#### Scenario: The root context counts both classes

- **WHEN** `openspec/config.yaml` is read
- **THEN** its repository description states seven packages in root-level `pi-*/` and `dsh-*/` directories, published independently as `@indexyz/<name>`, with the dsh packages built
