# Spec Delta

## ADDED Requirements

### Requirement: Thinking stays with the model that produced it

An Ollama request SHALL replay an assistant message's thinking only to the model that produced it. A different provider, API, or model id SHALL receive that message's visible text and tool calls without its thinking, in neither `content` nor `thinking`.

#### Scenario: Model changes mid-session

- **WHEN** a model answers with thinking and the session switches to another model on the same provider
- **THEN** the next request contains the earlier answer's visible text
- **AND** it does not contain the earlier thinking

#### Scenario: Same model continues

- **WHEN** a model answers with thinking and the session continues on that model
- **THEN** the next request carries that thinking in the assistant message's `thinking` field

### Requirement: Vendored host logic matches the pinned host

The functions the package vendors from pi-ai SHALL produce the same results as the pinned host's implementations on the same input, checked against the `pi-ai` version the package pins.

#### Scenario: Vendored copy drifts

- **WHEN** a vendored function differs from the host's on a fixture
- **THEN** the package test fails and names the fixture

#### Scenario: Resolved host is not the pin

- **WHEN** the resolved `pi-ai` version differs from the package's pin
- **THEN** the package test fails and names both versions
