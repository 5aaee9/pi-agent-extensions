# pi-package-e2e Specification

## Purpose

Define how Pi packages are proven from the outside: as the artifacts users install, driven through the published Pi bin, so a passing run is evidence about what users run, and so a future Pi release is rehearsed before users meet it.

## Requirements

### Requirement: Scenarios exercise the installed artifact

Every E2E scenario SHALL run a Pi package packed into a tarball and installed through Pi's own install command into an isolated agent directory, with no host package resolvable from the install location, using the published `pi` bin.

#### Scenario: A module is missing from the package's files allowlist

- **WHEN** a package imports or reads at runtime a file its `files` allowlist does not ship
- **THEN** the scenario that reaches that code fails even though the file exists in the checkout

#### Scenario: A package relies on a host subpath Pi does not map

- **WHEN** a package imports a host module path that resolves from a workspace `node_modules` but not through Pi's extension module mapping
- **THEN** the scenario fails, because no host package exists on disk beside the installed copy

#### Scenario: A temporary directory sits under a node_modules tree

- **WHEN** the configured temporary location would let the installed package resolve a host package by walking up the directory tree
- **THEN** the run fails before executing a scenario and names the location

### Requirement: Scenarios observe only public surfaces

An E2E scenario SHALL drive and observe Pi only through its RPC, print, and JSON modes, a real pseudo-terminal, documented on-disk files, and the requests that reach a local server. It SHALL NOT import package source or Pi internals.

#### Scenario: Pi reorganizes its private files

- **WHEN** a Pi release moves internal modules without changing public behaviour
- **THEN** the suite still runs, and it fails only if a package's own dependence on those modules breaks

#### Scenario: A scenario needs a behaviour RPC cannot reach

- **WHEN** a surface is a no-op in RPC mode, such as a custom component or the footer
- **THEN** the scenario drives it through a real pseudo-terminal rather than a substitute

### Requirement: Scenarios need no credential and keep package traffic on loopback

An E2E scenario SHALL direct every package's model, discovery, billing, and usage traffic only to servers it started on the loopback interface, which answer the provider's real protocol, and SHALL need no real credential or live endpoint. A scenario SHALL run offline unless it needs a package's own discovery, billing, or usage traffic to local servers.

#### Scenario: A relay protocol is exercised

- **WHEN** a scenario covers a provider API
- **THEN** a local server decodes the real request Pi sends, and the assertions hold on that request and on Pi's handling of the reply

#### Scenario: A package defaults to an external endpoint

- **WHEN** a package's default configuration contacts a third-party service, as `pi-custom-provider` does for `models.dev`
- **THEN** the scenario's configuration disables that request or points it at a local server

#### Scenario: A provider scenario runs without offline mode

- **WHEN** a scenario leaves offline mode because it needs a package's own traffic to local servers
- **THEN** Pi's own best-effort catalog refresh may leave the machine, and no assertion in that scenario depends on a value from Pi's catalog

#### Scenario: A behaviour needs a live endpoint

- **WHEN** a behaviour can only be observed against a live service
- **THEN** no scenario claims to cover it, and the gap is stated in the repository's verification documentation

### Requirement: A scenario earns its place

Every scenario SHALL name the concrete failure mode it guards, backed by an upstream report, a regression in this repository, a confirmed defect, or a host contract whose breakage would be silent. A candidate with none of these SHALL NOT be added.

#### Scenario: A candidate has only a coverage rationale

- **WHEN** a proposed scenario would raise coverage without naming a realistic failure
- **THEN** it is not added

#### Scenario: A scenario is added

- **WHEN** a scenario lands
- **THEN** it has been observed failing once against a deliberate regression of the behaviour it guards, and that observation is recorded for review, not committed as code

### Requirement: Configured packages register through the real bin

The configured registration check SHALL assert each Pi package's expected commands and models, or another observable effect for a package that has neither, so a package that registers nothing cannot pass by answering an empty command list. The unconfigured load check in `plugin-e2e-loading` is separate and asserts only a clean load.

#### Scenario: A provider package has a valid configuration

- **WHEN** a provider package starts with a configuration pointing at a local server
- **THEN** its expected commands and discovered models are present

#### Scenario: A package registers no command or model

- **WHEN** a package such as `pi-skill` contributes no command and no model even when it loads
- **THEN** its entry names an effect observable at the local server or over RPC, so a package that failed to load cannot pass

#### Scenario: A new Pi package is added

- **WHEN** a Pi package exists in the workspace with no entry declaring its expected registrations
- **THEN** the run fails and names the package

### Requirement: Co-installed packages survive the session lifecycle

All Pi packages installed together SHALL complete a turn in print, JSON, and RPC modes, and in RPC mode survive a model change, a new session, and a fork, with no extension error and a clean, bounded process exit.

#### Scenario: A session is replaced

- **WHEN** a new session or fork replaces the running session
- **THEN** the next turn succeeds and no extension reports a stale context

#### Scenario: A print run ends with a background timer armed

- **WHEN** a print-mode turn finishes while a package holds a timer or an open request
- **THEN** the process exits within the bound

### Requirement: Silent host dependencies are guarded

Where a package falls back silently when a host dependency disappears, a scenario SHALL assert the capability that fallback would remove, in the installed shape.

#### Scenario: Private host modules move

- **WHEN** the private pi-ai modules behind native Codex compaction cannot be loaded
- **THEN** a scenario fails because `/openai-compress` is absent or a compaction checkpoint is not replayed

#### Scenario: Provider transcript input changes shape

- **WHEN** a Pi release changes how transcripts, system prompts, or tools reach a provider adapter
- **THEN** a scenario fails because the request at the local server no longer carries them

#### Scenario: Interactive extension surfaces stop working

- **WHEN** a Pi release changes custom components, autocomplete triggers, message renderers, or the footer
- **THEN** a scenario fails through a real pseudo-terminal

### Requirement: Vendored host logic is compared with the pinned host

Code a package vendors because Pi does not expose it to extensions SHALL be compared by a test against the pinned host's own implementation, on the same fixtures, so a pin change reports drift.

#### Scenario: A pin bump changes vendored behaviour

- **WHEN** the pinned host's implementation produces a different result from the vendored copy
- **THEN** the comparison fails and names the differing fixture

#### Scenario: The comparison resolves a different host copy

- **WHEN** the workspace hoists another version of the host package, and the resolved copy differs from the package's pin
- **THEN** the comparison fails and names both versions instead of comparing against the wrong host

### Requirement: A confirmed defect's scenario lands with its fix

A scenario for a confirmed defect SHALL land in the same change as the fix, and SHALL have been observed failing before it. The suite SHALL carry no skipped, expected-failure, or todo scenarios.

#### Scenario: A defect cannot be fixed yet

- **WHEN** a defect's fix is deferred
- **THEN** its scenario does not land, and the defect stays recorded instead of the suite carrying a known failure

### Requirement: Scenarios are isolated and clean up

Each scenario SHALL use its own agent, session, home, npm cache, and working directories and its own servers, SHALL be bounded by a timeout, and SHALL terminate every process it spawned and remove every directory it created on all exit paths.

#### Scenario: A process hangs

- **WHEN** a Pi process does not exit within the bound
- **THEN** its process group is killed, its temporary directories are removed, and the failure reports the command and captured output

#### Scenario: The developer's own Pi configuration exists

- **WHEN** the suite runs on a machine with a real `~/.pi` or `~/.npm` directory
- **THEN** nothing under them is read or written

### Requirement: The suite runs in CI and by hand

The repository SHALL expose the suite as a root script that runs without building or installing any dsh package, and CI SHALL run it for pushes and pull requests, failing the workflow on any failed scenario.

#### Scenario: A pull request breaks a scenario

- **WHEN** a pull request changes a Pi package so a scenario fails
- **THEN** the quality workflow fails and reports the scenario, the command, and captured output

#### Scenario: Only dsh packages changed

- **WHEN** the suite runs
- **THEN** it does not touch `dsh-*` directories, and the separate dsh loading check is unchanged

### Requirement: Future Pi releases are rehearsed

A scheduled workflow SHALL, in a throwaway checkout, move the Pi packages' pins to the newest published Pi and run their typecheck, package tests, and the E2E suite. It SHALL push nothing, hold no secrets, and leave dsh pins unchanged.

#### Scenario: Pi publishes a breaking release

- **WHEN** a new Pi release removes an export, renames an event, or changes a behaviour a scenario guards
- **THEN** the scheduled run fails and reports the Pi version it tested, before the repository's pin moves

#### Scenario: A pin is older than latest

- **WHEN** the newest Pi release differs from the repository's pin
- **THEN** pull request checks still run against the pin and do not fail because of the newer release

#### Scenario: An older or specific host is checked by hand

- **WHEN** an operator starts the workflow naming a Pi version
- **THEN** the rehearsal runs against that version instead of the newest
