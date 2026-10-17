# Spec Delta

## Purpose

Define `@indexyz/dsh-custom-provider-reasoning-efforts` as a published package: its manifest for the Harness loader, the host half it builds and commits, how it is verified before it is uploaded, and the release decision its first version carries.

## ADDED Requirements

### Requirement: The package publishes as `@indexyz/dsh-custom-provider-reasoning-efforts`

The package SHALL be the root-level directory `dsh-custom-provider-reasoning-efforts/`, published as `@indexyz/dsh-custom-provider-reasoning-efforts` with `publishConfig.access` `public`, `repository.url` and `repository.directory` naming this repository and the directory, and `engines.node` `>=22.19.0`. Its manifest SHALL declare a `dsh` manifest with a bundle patch layer at `./cordis.patch.yml` and SHALL declare no `dsh.client` (there is no browser half), `main` at the built `lib/index.js`, `types` at the built declarations, and `exports` for `.` and `./package.json`; it SHALL declare no `pi` manifest. Its `files` allowlist SHALL ship `lib`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, and `LICENSE`, and SHALL NOT ship `test/`, `tsconfig*.json`, `vitest.config.ts`, or `openspec/`. The bundle patch SHALL insert exactly one row for `@indexyz/dsh-custom-provider-reasoning-efforts` carrying the row configuration (an empty `providers` table). Its `engines.dsh` SHALL name the Harness range it is built against.

#### Scenario: The packed tarball is what the manifest promises

- **WHEN** `npm pack --workspace @indexyz/dsh-custom-provider-reasoning-efforts` runs
- **THEN** the tarball contains `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `cordis.patch.yml`, the declared `lib` entries, and nothing under `test/` or `openspec/`

#### Scenario: The Harness can resolve every entry

- **WHEN** a profile mounts the package through its bundle patch
- **THEN** the row resolves the package's `main` entry and the Loader parses the row's `Config`

#### Scenario: It is not a Pi package

- **WHEN** the package's manifest is read by the repository's Pi tooling
- **THEN** it declares no `pi` manifest and the root `pi.extensions` does not list it

### Requirement: The host half is a Cordis plugin with one row and one command

The host half SHALL export `name`, `inject`, `Config`, and `apply` from its built entry, with `apply` registering the `/reasoning-efforts` command through the injected command registry and returning without awaiting any probe. `Config` SHALL validate the row's fields (`providers`, `discover`, `discoverRoutes`, `namespace`, `applyOnLoad`) and SHALL reject a malformed declaration while the plugin loads. The host half SHALL import only packages the Harness installation supplies (`@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/dsh-llm`) and SHALL declare each as a `"*"` peer with an exact pin in its own `devDependencies`.

#### Scenario: The plugin loads

- **WHEN** the Loader mounts the row
- **THEN** the module's `inject` names `commands`, its `apply` registers the command, and no network request is awaited during the load

#### Scenario: A host package is missing

- **WHEN** the tarball is installed without its peers
- **THEN** the declared release smoke check still verifies the packaged entry and the Loader supplies the peers at runtime

### Requirement: The package is verified from its packed tarball

The manifest SHALL declare `release.smoke` at `test/smoke-release.ts`, a script the release engine runs against the packed and installed tarball as its replacement for the Pi load. The script SHALL require the installed manifest to carry the expected name and version, SHALL require every `main` and `exports` target, the built host entry, and `cordis.patch.yml` to be present, SHALL require the bundle patch to insert exactly one row naming this package, and SHALL exit `0` with one line or non-zero with one line naming the invariant that broke. It SHALL use only Node built-ins and erasable syntax so `node` runs it directly from TypeScript. The package's `check` script SHALL typecheck, build, and test, and its `prepack` SHALL run `check`.

#### Scenario: The installed tarball is intact

- **WHEN** the release engine installs the packed tarball and runs the declared smoke check
- **THEN** it exits `0` having verified the manifest targets, the built entry, and the bundle patch

#### Scenario: A promised file is missing

- **WHEN** a `main` or `exports` target, the built entry, or the bundle patch is absent from the installed copy
- **THEN** the check exits non-zero with a line naming the missing file

#### Scenario: The bundle patch is wrong

- **WHEN** `cordis.patch.yml` does not insert a row naming this package
- **THEN** the check exits non-zero with a line saying so

### Requirement: The package documents itself and carries a release decision

`README.md` SHALL state what the plugin fixes, how to install it, the declaration shape, the command modes, the row configuration fields, and the behavior and limitations of the write and the probe; `CHANGELOG.md` SHALL carry its `## 0.1.0` section; the root `README.md` table SHALL list the package. The change SHALL record a hand-written `.changeset/<id>.md` naming the package with `none` and the reason that the plan publishes an absent version, so no bump is due.

#### Scenario: The first version is prepared

- **WHEN** the release plan runs over the version that carries this package
- **THEN** `@indexyz/dsh-custom-provider-reasoning-efforts@0.1.0` is the version built, inspected, installed, and smoke-checked, and no bump intent is pending for it

#### Scenario: The documentation matches the row

- **WHEN** the README's configuration table is compared with `Config`
- **THEN** every field, its default, and its meaning are stated
