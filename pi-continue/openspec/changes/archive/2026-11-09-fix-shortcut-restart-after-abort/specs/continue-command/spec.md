# Spec Delta

## ADDED Requirements

### Requirement: A shortcut never outlives a running turn

A shortcut pressed while the agent is busy SHALL start nothing and leave nothing waiting, so
interrupting that turn afterwards does not retry it. A shortcut pressed while an abort is
settling SHALL wait for the abort and then retry.

#### Scenario: A shortcut during a running turn

- **WHEN** a shortcut is pressed during a running turn and the user then interrupts that turn
- **THEN** a busy notice appears and no further model request is sent

#### Scenario: A shortcut while an abort is settling

- **WHEN** a shortcut is pressed after an interrupt while an aborted tool is still finishing
- **THEN** one model request is sent once the abort has settled
