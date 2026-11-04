# Spec Delta

## MODIFIED Requirements

### Requirement: Pi packages load through the Pi host

Each Pi package SHALL be packed into a tarball and installed with Pi's own install command into an isolated agent directory, leaving no host package resolvable from the install location. It SHALL then be loaded through the installed copy with the published Pi binary resolved from that package and matching its exact development dependency pin, in non-interactive RPC mode, offline, with isolated session and agent directories, and SHALL succeed only when the process exits 0 and returns a successful `get_commands` response.

#### Scenario: A Pi extension registers commands

- **WHEN** the runner loads a Pi package whose extensions register commands
- **THEN** the RPC response reports `get_commands` as successful and the package passes

#### Scenario: A Pi extension entry fails to register

- **WHEN** an extension entry throws while the Pi host loads it
- **THEN** the run reports that package as failed with the host's load diagnostics

#### Scenario: Local dependencies resolve the wrong Pi version

- **WHEN** the resolved Pi version differs from the package's development pin
- **THEN** the runner fails that package before loading it, reports the expected and installed versions, and asks for dependency installation

#### Scenario: A statically imported module is missing from the tarball

- **WHEN** a Pi package's entry statically imports a module its `files` allowlist does not ship
- **THEN** the run reports that package as failed with the host's load diagnostics, even though the module exists in the checkout

#### Scenario: A package imports a host path Pi does not map

- **WHEN** a Pi package imports a host module path that only resolves from a workspace `node_modules`
- **THEN** the run reports that package as failed, because the installed copy has no host package beside it
