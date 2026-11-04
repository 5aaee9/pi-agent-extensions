# idle-compression Specification

## Purpose

Compact a session's context with Pi's native compaction once it has been idle, with no new input, for a configurable time set globally, per provider, or per model.

## Requirements

### Requirement: Compact after an idle period

The extension SHALL start an idle period when Pi emits `agent_settled`, and when a session starts whose branch already contains an assistant message. When the effective idle time elapses with no user input and no new agent run, it SHALL call Pi's native compaction once for that idle period.

#### Scenario: Idle session is compacted

- **WHEN** a turn settles and no input arrives for the effective idle time
- **THEN** the session receives one native compaction entry
- **AND** the user is notified that idle compaction started and completed

#### Scenario: New input cancels the idle period

- **WHEN** the user sends input or an agent run starts before the idle time elapses
- **THEN** no idle compaction happens for that idle period
- **AND** a new idle period starts when Pi settles again

#### Scenario: Only once per idle period

- **WHEN** idle compaction has completed and the session stays idle
- **THEN** no further compaction happens until a new idle period starts

### Requirement: Never interrupt or repeat work

When the idle time elapses, the extension SHALL NOT compact if Pi is not idle, has pending messages, the last branch entry is already a compaction, or the context usage is unmeasured after a compaction. A compaction attempt from another source SHALL end the idle period when it starts, even if it later fails or is cancelled.

#### Scenario: Already compacted

- **WHEN** the user runs `/compact` during an idle period
- **THEN** idle compaction does not run for that idle period

#### Scenario: Manual compaction fails

- **WHEN** manual compaction starts during an idle period and its summary request fails
- **THEN** the original idle timer does not start another compaction

#### Scenario: Manual compaction is cancelled

- **WHEN** manual compaction starts during an idle period and the user cancels it
- **THEN** the original idle timer does not start another compaction

#### Scenario: Work after a failed compaction

- **WHEN** a failed manual compaction ended an idle period and a later agent run settles
- **THEN** a new idle period can compact the conversation once

### Requirement: Layered settings

The extension SHALL read `piIdleCompression` from user `settings.json` when it arms an idle period. `enabled` (boolean, default `true`) and `idleMinutes` (positive number of minutes up to 35791, default 50) SHALL each resolve from `models["provider/modelId"]`, then `providers["provider"]`, then the top level, then the default. An invalid value SHALL be reported as an error and SHALL leave the idle period unarmed.

#### Scenario: Model overrides provider and global

- **WHEN** settings set `idleMinutes` 50 at top level, 30 for provider `p`, and 10 for model `p/m`
- **THEN** a session on `p/m` compacts after 10 idle minutes and another model of `p` after 30

#### Scenario: Disabled for one model

- **WHEN** `models["p/m"].enabled` is `false`
- **THEN** sessions on `p/m` are never idle-compacted while other models still are

#### Scenario: Invalid setting

- **WHEN** `idleMinutes` is zero, negative, not a number, or too large
- **THEN** an error notification names the setting and no idle compaction is armed

### Requirement: Status command

`/idle-compression` SHALL report the effective `enabled` and `idleMinutes` for the current model and, when an idle period is armed, the time left. It SHALL NOT write settings or start compaction.

#### Scenario: Status while armed

- **WHEN** the user runs `/idle-compression` while an idle period is armed
- **THEN** the notification names the model, the idle time, and the remaining time
