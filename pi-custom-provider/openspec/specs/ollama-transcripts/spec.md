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
