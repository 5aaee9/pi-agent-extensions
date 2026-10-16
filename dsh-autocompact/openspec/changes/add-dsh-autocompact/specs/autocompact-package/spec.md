# Spec Delta

## Purpose

Define `@indexyz/dsh-autocompact` as a published package: its manifest for the Harness loader, the two halves it builds and commits, how it is verified before it is uploaded, and the release decision its first version carries.

## ADDED Requirements

### Requirement: The package publishes as `@indexyz/dsh-autocompact`

The package SHALL be the root-level directory `dsh-autocompact/`, published as `@indexyz/dsh-autocompact` with `publishConfig.access` `public`, `repository.url` and `repository.directory` naming this repository and the directory, and `engines.node` `>=22.19.0`. Its manifest SHALL declare a `dsh` manifest (a bundle patch layer at `./cordis.patch.yml`, and for the client half the platform `web`, immediate loading, and the injected `@deepseek-ai/dsh-client-*` services), `main` at the built `lib/index.js`, `types` at the built declarations, and `exports` for `.`, `./client` (`./client.js`), and `./package.json`; it SHALL declare no `pi` manifest. Its `files` allowlist SHALL ship `lib`, `src`, `client.js`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, and `LICENSE`, and SHALL NOT ship `test/`, `tsconfig*.json`, `tsdown.config.ts`, `vitest.config.ts`, or `openspec/`. The bundle patch SHALL insert exactly one row for this package carrying its `config` (the row's `modelLimits` and `enabled` are the Settings-editable fields).

#### Scenario: The packed tarball is what the manifest promises

- **WHEN** `npm pack --workspace @indexyz/dsh-autocompact` runs
- **THEN** the tarball contains `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `cordis.patch.yml`, `client.js`, the declared `lib` and `src` entries, and nothing under `test/` or `openspec/`

#### Scenario: The Harness can resolve every entry

- **WHEN** a profile mounts the package through its bundle patch
- **THEN** the row resolves the package's `main` entry for the host half and the page fetches the `./client` export for the client half

#### Scenario: It is not a Pi package

- **WHEN** the package's manifest is read by the repository's Pi tooling
- **THEN** it declares no `pi` manifest and the root `pi.extensions` does not list it

### Requirement: Both halves build into committed artifacts

The package SHALL provide `build` (host then client), `build:host` (`tsc -p tsconfig.build.json` into `lib/`), `build:client` (the bundler into a root `client.js`), `test`, `test:watch`, `typecheck`, `check`, and `prepack`. `check` SHALL run `typecheck`, then `build`, then `test`, and `prepack` SHALL run `check`. The host half SHALL compile to `lib/index.js` with its declarations, declaration maps, and source maps, with relative import extensions rewritten. The client artifact SHALL be the one module registration the Harness page's loader accepts: a single `window.__ModuleLoader__.load({ id: "@indexyz/dsh-autocompact", factory })` whose factory body is ordinary CommonJS, with `react` and `react/jsx-runtime` left as external `require` calls because the page's module table provides them, and it SHALL carry a generated-file header naming its source and the command that rebuilds it. Both artifacts SHALL be committed to Git and not ignored, because a profile installs the directory as a `link:` dependency that serves those files as they are on disk.

#### Scenario: One command builds both halves

- **WHEN** `npm run build --workspace @indexyz/dsh-autocompact` runs
- **THEN** `lib/` and `client.js` are both written from the current sources

#### Scenario: A link install serves the committed artifacts

- **WHEN** the profile's dependency on the package is a `link:` to the checkout and the profile boots
- **THEN** the host half loads `lib/index.js` and the web page loads the committed `client.js`, with no build step at install time

#### Scenario: Packing builds and tests first

- **WHEN** the release plan packs the package
- **THEN** its `prepack` runs the package's typecheck, build, and tests on the version commit before the tarball is produced

#### Scenario: The bundle keeps React external

- **WHEN** the committed `client.js` is inspected
- **THEN** it requests `react` and `react/jsx-runtime` through the loader's `require` and does not inline them

### Requirement: The package is verified by its tests, its release smoke check, and a live install

The package SHALL carry its Vitest suite in `test/` (`index.test.ts`, `compaction.test.ts`, `settings.test.ts`, and `client.test.ts`, 65 cases in total) covering the command, the range selection, the threshold grammar and defaults, and the client's state, store, and rendering. It SHALL declare `release.smoke` in its manifest as `test/smoke-release.ts`, a TypeScript script the release engine runs against the installed tarball, using only Node built-ins and erasable syntax so Node runs it directly. That script SHALL verify the installed copy and nothing else: the installed `package.json` names this package, every `main` and `exports` target and `lib/index.js` exist, the packaged `client.js` registers exactly one module through a stub `window.__ModuleLoader__.load` with only `react` and `react/jsx-runtime` available, that registration's id is this package, its `factory` returns a module exporting an `inject` string list and an `apply` function, and it SHALL exit with status 0 and one line on success or non-zero with one line naming the invariant that broke. The package SHALL also be verified live by installing the directory into a dsh profile as a `link:` dependency and exercising the command, the Settings section, and the composer pill.

#### Scenario: The unit suite runs in the repository gate

- **WHEN** `npm run check` runs from the repository root
- **THEN** the root build step builds both halves and all 65 cases pass with the rest of the workspace

#### Scenario: The release check evaluates the installed artifact

- **WHEN** the release plan verifies an upload of this package
- **THEN** it installs the tarball into an empty directory and runs `node <worktree>/dsh-autocompact/test/smoke-release.ts <installed-package-dir>`
- **AND** a broken registration, a foreign module id, a missing `lib/index.js`, or a module without `apply` fails the plan before upload

#### Scenario: The live install is exercised

- **WHEN** the package is installed into the `web` profile as a `link:` dependency (`dsh plugin --profile web add ./dsh-autocompact`) and the profile boots
- **THEN** `/autocompact`, the Settings section, and the composer pill all behave as this change's specs describe

### Requirement: The first version carries a `none` release decision and ships as `0.1.0`

The package SHALL start at version `0.1.0` with a `## 0.1.0` section in its `CHANGELOG.md`, and the change that introduces it SHALL record one hand-written intent `.changeset/dsh-autocompact-first-version.md` naming `@indexyz/dsh-autocompact` with `none` and the reason that the package ships as its own first version, which the plan publishes because it is absent from npm, so no bump is needed. A positive intent MUST NOT be recorded, because it would bump the version past the one the package debuts with. The first upload SHALL be performed by the owner, because npm binds a trusted publisher in an existing package's settings: the plan verifies the version and CI cannot upload it, the owner publishes that exact tarball once, adds the trusted publisher, and reruns so the tag `@indexyz/dsh-autocompact@0.1.0` and its GitHub Release are recorded. Agents MUST NOT perform that step.

#### Scenario: The first plan lists the package as an upload

- **WHEN** `0.1.0` is absent from npm, the manifest carries the field, and `test/smoke-release.ts` passes against the tarball
- **THEN** the plan lists `@indexyz/dsh-autocompact@0.1.0` as an upload verified by the declared check

#### Scenario: No bump is recorded

- **WHEN** the change's intent file is read
- **THEN** it maps `@indexyz/dsh-autocompact` to `none` with a summary explaining the first version, and no positive intent for the package exists

#### Scenario: The bootstrap needs the owner

- **WHEN** the publish job reaches the first upload of this package
- **THEN** it fails at the upload, the owner publishes the verified tarball from the run's `release-batch` artifact, adds the trusted publisher, and reruns so the tag and Release are created

### Requirement: The README and CHANGELOG document the package

`README.md` SHALL document what the plugin does, how to install it (`dsh plugin --profile web add @indexyz/dsh-autocompact`), the `/autocompact` grammar and its session scope, the Settings page and the composer pill, the optional global defaults table with its defaults, the behavior and limitations (no configuration from the command, the backend's own compaction untouched, the deployment default rather than a session override in the pill, overshoot, summary cost, and the required backend capability), and the development commands for both halves. `CHANGELOG.md` SHALL describe the first version's user-visible behavior.

#### Scenario: The README matches the shipped behavior

- **WHEN** the README is read after the change
- **THEN** every command, field, default, and limitation it states is the behavior this change's specs define
