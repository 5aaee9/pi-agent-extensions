# Spec Delta

## ADDED Requirements

### Requirement: Boundary summaries use the session's model options

A boundary summary request SHALL carry the same reasoning effort and output token limit as a native compaction's summary request for the same model and thinking level.

#### Scenario: Reasoning model at a thinking level

- **WHEN** autocompact summarizes at a boundary on a reasoning model with a thinking level set
- **THEN** the summary request carries the reasoning effort and the output token limit that a native compaction's summary request carries
