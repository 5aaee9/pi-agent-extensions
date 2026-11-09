# Spec Delta

## REMOVED Requirements

### Requirement: A shortcut never outlives a running turn

**Reason**: The rule now covers `/continue` as well as the shortcuts.
**Migration**: See "A retry never outlives a running turn".

## ADDED Requirements

### Requirement: A retry never outlives a running turn

`/continue` and the shortcuts SHALL behave identically on a busy session. During a running turn
they SHALL start nothing and leave nothing waiting, so interrupting that turn afterwards does not
retry it. While an abort or a compaction is finishing they SHALL wait for it and then retry.

#### Scenario: A retry requested during a running turn

- **WHEN** `/continue` or a shortcut is used during a running turn and the user then interrupts that turn
- **THEN** a busy notice appears and no further model request is sent

#### Scenario: A retry requested while an abort is settling

- **WHEN** `/continue` or a shortcut is used after an interrupt while an aborted tool is still finishing
- **THEN** one model request is sent once the abort has settled

#### Scenario: A retry requested during a compaction

- **WHEN** `/continue` is used during a compaction on a session whose last turn failed
- **THEN** one model request is sent once the compaction has finished
