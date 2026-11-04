# Model probes

## Purpose

Runs independent model fingerprint probes with the selected Pi host and settings, then reports the resulting model attribution in the parent session.

## ADDED Requirements

### Requirement: Probe host selection

Probes SHALL use the currently running Pi installation by default, without resolving another Pi installation from PATH. An explicit `PI_MODEL_TRACE_BIN` SHALL select the requested executable instead.

#### Scenario: Pi is absent from PATH

- **WHEN** the user starts Pi by its absolute path and runs `/model-trace`
- **THEN** all three probes run through that Pi installation and produce a report

#### Scenario: Explicit executable

- **WHEN** `PI_MODEL_TRACE_BIN` names a different executable
- **THEN** probes use that executable

### Requirement: Probe settings and isolation

Each probe SHALL use an independent non-persisted session with tools disabled and the selected provider/model and effective thinking level, including `off`.

#### Scenario: Explicit thinking off

- **WHEN** the current session uses thinking `off` while saved settings enable thinking
- **THEN** all probe requests retain thinking `off`

### Requirement: Bounded probe lifecycle

Each probe SHALL stop after ten minutes or one MiB of combined output. Output-limited and other failed probes SHALL be reported as failures and SHALL NOT contribute partial numbers to attribution. Active probes SHALL stop on session shutdown without starting retries or appending a late report.

#### Scenario: Failed output contains numbers

- **WHEN** a probe exits unsuccessfully after emitting a numeric sequence
- **THEN** the report identifies the failure and excludes that sequence from scoring

#### Scenario: Session shutdown

- **WHEN** the session shuts down while probes are running
- **THEN** their processes are cancelled and no report is appended after shutdown
