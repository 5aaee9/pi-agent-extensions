# Spec Delta

## ADDED Requirements

### Requirement: The retry marker never reaches a provider

The hidden message `/continue` uses to start a turn SHALL be removed before every model call, so no provider receives an empty message for it.

#### Scenario: A provider adapter keeps empty user messages

- **WHEN** `/continue` retries a failed turn on `ollama-chat`
- **THEN** the request carries only the original user message
