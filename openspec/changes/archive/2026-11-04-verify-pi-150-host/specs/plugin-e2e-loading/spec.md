## MODIFIED Requirements

### Requirement: Pi packages load through the Pi host

Each Pi package SHALL be loaded with the Pi binary resolved from that package and matching its exact development dependency pin in non-interactive RPC mode, offline, with isolated session and agent directories, and SHALL succeed only when the process exits 0 and returns a successful `get_commands` response.

#### Scenario: A Pi extension registers commands

- **WHEN** the runner loads a Pi package whose extensions register commands
- **THEN** the RPC response reports `get_commands` as successful and the package passes

#### Scenario: A Pi extension entry fails to register

- **WHEN** an extension entry throws while the Pi host loads it
- **THEN** the run reports that package as failed with the host's load diagnostics

#### Scenario: Local dependencies resolve the wrong Pi version

- **WHEN** the resolved Pi version differs from the package's development pin
- **THEN** the runner fails that package before loading it, reports the expected and installed versions, and asks for dependency installation
