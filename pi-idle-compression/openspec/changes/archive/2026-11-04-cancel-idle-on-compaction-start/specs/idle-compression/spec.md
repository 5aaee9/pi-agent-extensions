# Spec Delta

## MODIFIED Requirements

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
