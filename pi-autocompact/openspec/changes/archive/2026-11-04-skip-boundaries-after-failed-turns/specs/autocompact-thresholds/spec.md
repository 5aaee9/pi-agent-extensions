# Spec Delta

## ADDED Requirements

### Requirement: Boundary compaction runs only after a completed turn

Boundary compaction SHALL NOT send a summary request for a turn whose outcome is an error or an abort, and a skipped boundary SHALL NOT count as an attempt.

#### Scenario: A turn fails over the threshold

- **WHEN** a turn fails with an upstream error while context usage is above the threshold
- **THEN** no summary request is sent

#### Scenario: The next turn succeeds

- **WHEN** a later turn completes while usage is above the threshold
- **THEN** one summary request is sent and the compaction is committed
