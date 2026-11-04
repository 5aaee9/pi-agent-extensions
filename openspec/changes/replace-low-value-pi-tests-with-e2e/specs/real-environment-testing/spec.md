# Spec Delta

## MODIFIED Requirements

### Requirement: Every package test exercises its pinned host plane

Every test in a package's `test/` tree SHALL drive that package through the host packages it pins in its `devDependencies` at runtime — mounted, registered, or loaded through the host's own public mechanisms — and SHALL NOT replace a host package, a host service, or a host API with a hand-written stand-in for the duration of the test. A Pi package test MAY instead call the package's own logic directly, on plain data or with real pinned host utilities, provided it simulates no host behaviour, and MAY compare vendored host logic with the pinned host's implementation. The existing tests of `pi-ask`'s Pi 1.4.0 status fallback are retained until that fallback is removed. A dsh package test has none of these exceptions.

#### Scenario: A host API contract changes on the pinned line

- **WHEN** a mounted host service gains or loses a dependency in its own `inject` list, or renames or removes an export the package consumes
- **THEN** the package test observes the change through the real service graph and fails or passes as the real host decides, without the test being edited to describe the new contract

#### Scenario: A test constructs a stand-in host

- **WHEN** a test in any package builds its host out of a fake settings object, a fake engine, a fake LLM stream, or a module/global replacement of a host package
- **THEN** that test does not meet this requirement and must be rewritten to drive the real plane

#### Scenario: A Pi package test exercises pure logic

- **WHEN** a Pi package test calls its own parser, state reducer, or config migration with plain inputs, including session entries passed as data
- **THEN** it meets this requirement, because no host behaviour is being simulated

#### Scenario: A Pi package test uses a real host utility

- **WHEN** a Pi package test calls a real pinned host utility such as `SessionManager`, `SettingsManager`, or `matchesKey` without loading the extension
- **THEN** it meets this requirement, because the utility is the real one and nothing imitates it

#### Scenario: A Pi package test simulates host behaviour for pure logic

- **WHEN** a Pi package test supplies an object that imitates a host's decisions, lifecycle, or events, such as a fake model registry answering auth checks or a hand-built `pi.on`
- **THEN** that test does not meet this requirement, because the imitation can disagree with the real host while the test passes

#### Scenario: The pi-ask Pi 1.4.0 fallback tests are retained

- **WHEN** the existing tests of `pi-ask`'s Pi 1.4.0 status fallback use a hand-built event registry
- **THEN** they stay as they are until that fallback is removed, and no new test may claim this exemption

### Requirement: Loading proof stays owned by the release smoke and the e2e run

Package unit tests SHALL NOT re-implement packing, isolated installation, or host-binary loading as their proof mechanism; the packed-and-installed proof remains the package's declared `release.smoke` script and the repository's `test:e2e` and `test:e2e:pi` runs.

#### Scenario: A unit test hand-packs its own tarball

- **WHEN** a unit test builds, packs, or installs its own package to stand in for the loading proof
- **THEN** the change is not the way this capability is satisfied; that proof remains in the declared smoke check and the e2e runs

#### Scenario: The declared smoke script changes its harness

- **WHEN** a package's `release.smoke` script is rewritten to run against a real environment instead of an in-process harness
- **THEN** the manifest still declares the same relative script, the published files do not change, and `npm run check` plus the e2e run must stay green

### Requirement: Conversion never touches published content

A conversion SHALL live inside the package's `test/` tree (test modules, helpers, and the package's own declared smoke script path) or, for a Pi package, the repository's root Pi E2E suite, and SHALL NOT change any file listed in the package's `files` allowlist, the package's runtime manifest fields (`dependencies`, `peerDependencies`, `exports`, the `dsh`/`pi` manifest, `files`, `release`), its versions, or its changelogs. The only manifest change a conversion MAY make is adding or removing `devDependencies` the test plane needs; each added entry SHALL be an exact version on the host line the package already pins, and because `package.json` ships in the tarball, that change SHALL carry a `none` release intent naming it as verification-only.

#### Scenario: A conversion needs a test-only host package

- **WHEN** exercising the real plane requires a host package (or a browser driver) the package does not already pin in `devDependencies`
- **THEN** the conversion adds it as an exact `devDependencies` entry and records a `none` intent for the package, and the release gate accepts the change

#### Scenario: A conversion would change a runtime dependency

- **WHEN** exercising the real plane would require changing `dependencies`, `peerDependencies`, or any published file
- **THEN** that change is a separate change with its own release decision, not part of a test conversion

#### Scenario: A test installs a package the manifest does not pin

- **WHEN** a test installs or loads a package by registry name that is neither pinned in the package's `devDependencies` nor present in `package-lock.json`
- **THEN** the test does not meet this requirement: the plane must be reproducible from the lockfile, so the package is pinned or replaced by a locally started route

#### Scenario: A Pi stand-in test moves to the root suite

- **WHEN** a Pi package's stand-in test is rewritten as a scenario in the root Pi E2E suite
- **THEN** the package's published files do not change, so the move carries no release decision by itself

## ADDED Requirements

### Requirement: Pi package tests assert behaviour that can break

A Pi package test SHALL assert behaviour a caller relies on and that could plausibly break. It SHALL NOT merely restate the implementation, assert a manifest, configuration, documentation, or test helper, assert Pi's behaviour rather than the package's, or pass regardless of the behaviour it names.

#### Scenario: A test pins a constant from the code

- **WHEN** a test's expected value is a copy of a constant, a default, or a display string whose change has no user-visible failure mode
- **THEN** the test does not meet this requirement and is removed

#### Scenario: A test checks the manifest

- **WHEN** a test reads a package's `package.json` to assert its dependency layout
- **THEN** the test does not meet this requirement; loading the installed tarball is the proof

#### Scenario: A test passes with its subject broken

- **WHEN** a test keeps passing after the behaviour it names is removed
- **THEN** the test is corrected to detect that behaviour or removed

### Requirement: A Pi regression guard is removed only with its replacement

A Pi package test that guards a real past bug or a user-visible behaviour SHALL be removed only after a scenario or test covering the same failure mode exists and has been observed detecting it.

#### Scenario: A stand-in test guards a production fix

- **WHEN** a test on a stand-in host is the only guard of a past production fix
- **THEN** the replacing E2E scenario lands and is observed failing against a regression of that fix before the original test is deleted
