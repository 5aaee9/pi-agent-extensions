# dsh-packages Specification

## Purpose

Define how dsh packages keep generated files out of source control while providing built artifacts for local Harness installs and published npm packages.

## Requirements

### Requirement: Generated dsh artifacts are ignored by Git

The repository SHALL ignore root-level `dsh-*/lib/` and `dsh-*/client.js` and SHALL NOT track generated files at those paths. Removing existing index entries SHALL preserve local output files.

#### Scenario: Build after checkout

- **WHEN** a contributor builds any dsh workspace package
- **THEN** its generated host and optional browser output exists on disk and does not appear as an untracked or modified file in Git

### Requirement: Packaging builds the artifacts the Harness loads

Each dsh package SHALL build its host and optional browser output during `prepack`, and its npm `files` allowlist SHALL include those artifacts despite Git ignoring them. Local checkout installation instructions SHALL run the package build before adding its directory to a dsh profile.

#### Scenario: Pack a checkout without generated output

- **WHEN** dependencies are installed and a dsh package is packed from a checkout containing no generated output
- **THEN** packing builds the output and the installed tarball passes the package's declared release smoke check

#### Scenario: Link a local checkout

- **WHEN** a contributor follows the documented checkout installation procedure
- **THEN** the host entry and optional browser bundle exist before the Harness loads the linked directory

### Requirement: A dsh package is a root-level workspace package of its own class

A dsh package SHALL be a root-level `dsh-<topic>/` directory listed in the root `package.json` `workspaces`, published as `@indexyz/dsh-<topic>` with `publishConfig.access` `public`, `repository.url` and `repository.directory` naming this repository and the directory, and `engines.node` `>=22.19.0`. Its manifest SHALL declare a `dsh` manifest (its bundle patch layer and, for a package with a client half, its `dsh.client` platform, load timing, and injected services), SHALL declare its entry points with `main`, `types`, and `exports` pointing at built files, and SHALL NOT declare a `pi` manifest. Its npm name, directory, and package OpenSpec root SHALL stay aligned, its Conventional Commit scope SHALL be the directory name without its class prefix, and the root `pi` manifest SHALL NOT list it, because Pi does not load a dsh package. The `@deepseek-ai/*` host packages a dsh package imports SHALL be pinned exactly in its `devDependencies` and declared `"*"` in its `peerDependencies`, never in `dependencies`, exactly as a `pi-*` package treats `@earendil-works/*`.

#### Scenario: Manifest and dependency shape

- **WHEN** a dsh package's `package.json` is read
- **THEN** it declares `name` `@indexyz/dsh-<topic>`, a `dsh` manifest, `main`/`types`/`exports` at built paths, `files` shipping its artifacts, every imported `@deepseek-ai/*` package as an exact `devDependencies` pin and a `"*"` `peerDependencies` entry, and no `pi` key

#### Scenario: Pi does not see the package

- **WHEN** the root `package.json` `pi.extensions` is read, or the repository is installed from git and loaded by Pi
- **THEN** it lists only `./pi-*/index.ts` entries, and the dsh package is not loaded by Pi
- **AND** there is no `pi -e ./dsh-<topic>/index.ts` command, because the package has no TypeScript extension entry

#### Scenario: The OpenSpec root stays with the package

- **WHEN** `openspec context --json` runs inside `dsh-<topic>/`
- **THEN** the resolved root is `dsh-<topic>/openspec`
- **AND** `npm pack --workspace @indexyz/dsh-<topic> --dry-run` lists no `openspec/` entry

### Requirement: Both halves build into generated artifacts

A dsh package with two halves SHALL provide `build` (host and client), `build:host` (the host half compiled with `tsc` into `lib/`), `build:client` (the client half bundled into a root `client.js`), `test`, `test:watch`, `typecheck`, `check`, and `prepack`; a package with no browser half omits `build:client`. Its `check` SHALL run `typecheck`, then `build`, then `test`, and its `prepack` SHALL run `check`, so packing always builds and tests the snapshot. The client artifact SHALL be the single module registration the Harness web module loader accepts — one `window.__ModuleLoader__.load({ id: "@indexyz/dsh-<topic>", factory })` whose factory body is ordinary CommonJS with `react` and `react/jsx-runtime` left external — and the host artifact SHALL be the compiled `lib/index.js` with its declarations. Because the installation supplies those peers, the release engine SHALL install such a package's tarball with `--legacy-peer-deps` in addition to `--omit=peer`, so npm's peer resolution cannot reject it. Both artifacts SHALL be build output that Git ignores, and a local profile install SHALL be preceded by a build, because `dsh plugin --profile <name> add <checkout>/dsh-<topic>` records a `link:` dependency that serves the files on disk as they are without building them.

#### Scenario: A build produces both halves

- **WHEN** `npm run build --workspace @indexyz/dsh-<topic>` runs
- **THEN** `lib/index.js` and its declarations are written by `tsc` and `client.js` is written by the bundler with the module-loader wrapper and the generated-file header

#### Scenario: A link install consumes the built files

- **WHEN** the package has been built and its directory is installed into a dsh profile as a `link:` dependency and the profile boots
- **THEN** the bundle patch row resolves the package through its `main` entry, and the web page fetches the same `client.js` the checkout holds

#### Scenario: Check builds before it tests

- **WHEN** a source file changes and `npm run check --workspace @indexyz/dsh-<topic>` runs
- **THEN** the artifacts are rebuilt before the tests run, and a test that imports `client.js` exercises the freshly built output

#### Scenario: The generated bundle is not hand-edited

- **WHEN** the client artifact is inspected
- **THEN** it carries a generated-file header naming its source and the command that rebuilds it

### Requirement: The root tooling builds the package and skips its generated paths

The root `check` SHALL build every workspace package that declares a `build` script, with the root `build` script running `npm run build --workspaces --if-present` before the workspace tests, so a package whose build is broken cannot pass unnoticed. The root linter and formatter SHALL ignore a dsh package's generated output (the `dsh-*/lib/**` and `dsh-*/client.js` paths in `ignorePatterns`); `.gitignore` ignores them too. The root `typecheck` and `test` fan-outs SHALL cover the new package through its own scripts like any other workspace package.

#### Scenario: The root check builds what declares a build

- **WHEN** `npm run check` runs at the repository root
- **THEN** `npm run build --workspaces --if-present` runs between the typecheck and the workspace tests
- **AND** the `pi-*` packages, which declare no `build` script, are skipped without an error

#### Scenario: Generated output is not linted or reformatted

- **WHEN** `npm run lint` and `npm run format:check` run with `dsh-<topic>/lib/` and `dsh-<topic>/client.js` present
- **THEN** neither reports a finding in those paths

### Requirement: A dsh package is release-eligible like every other workspace package

Every non-private workspace package SHALL remain a release candidate regardless of class, so a dsh package carries its own version in its `package.json`, records one release intent per published-content change, is prepared by the same runbook, is built and verified from its version commit, and is published, tagged `@indexyz/<name>@<version>`, and announced with a GitHub Release carrying that version's changelog section. Its verification SHALL be the check it declares with `release.smoke`, and a source change under a published path, or a change to a build input, SHALL require a release decision ("Dsh build inputs require release decisions" in `package-releases`). A package that has never been published SHALL start with an empty `0.0.0` bootstrap package that the owner publishes, because npm binds a trusted publisher in an existing package's settings; CI then publishes its formal version (`docs/releases/first-release.md`).

#### Scenario: The first version of a new dsh package

- **WHEN** a dsh package is pushed at `0.1.0` with a `## 0.1.0` changelog section, after the owner published its `0.0.0` bootstrap package and configured its trusted publisher
- **THEN** the plan lists `@indexyz/dsh-<topic>@0.1.0` as an upload, verified by its declared smoke check
- **AND** CI publishes it and creates its tag and GitHub Release

#### Scenario: A later version publishes like any other

- **WHEN** a prepared dsh package version is pushed to `main` with a trusted publisher in place
- **THEN** CI uploads the tarball built and verified from that version's commit, exactly as it does for a `pi-*` package

#### Scenario: A source change needs a decision

- **WHEN** a pull request changes only a file under `dsh-<topic>/src/` without a release decision
- **THEN** the release-impact gate fails and asks for one, because `src/` is a dsh build input
