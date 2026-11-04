# ollama-transcripts Specification

## Purpose

Preserve Pi's current prompt, active tools, and stream observation when conversing through an Ollama provider.

## Requirements

### Requirement: Current transcript state reaches Ollama

Ollama requests SHALL contain the current system prompt and active tool definitions after applying transcript section replacements, section deletions, tool additions, and tool removals in order. Conversation messages and tool results SHALL retain their order.

#### Scenario: Tool becomes available

- **WHEN** Pi activates a tool before an Ollama request
- **THEN** the outgoing request includes its name, description, and parameter schema
- **AND** its executed result appears in the continuation request

#### Scenario: Prompt and tool state changes

- **WHEN** a later system message replaces one prompt section, deletes another, removes a tool, and adds a new tool
- **THEN** the next request uses only the current section contents and tool definitions
- **AND** obsolete section contents and removed tool definitions are absent

### Requirement: Raw stream events remain observable

The adapter SHALL deliver each parsed Ollama stream event to the caller's observer and await completion before normalizing that event. Observer failures SHALL terminate the stream with an error.

#### Scenario: Asynchronous observer

- **WHEN** an observer asynchronously records each event
- **THEN** recording finishes before the event's normalized content becomes visible

#### Scenario: Observer fails

- **WHEN** an observer rejects an event
- **THEN** the request terminates with that failure and does not report success

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
