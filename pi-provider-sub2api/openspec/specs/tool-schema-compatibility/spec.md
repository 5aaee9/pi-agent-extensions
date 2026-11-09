# tool-schema-compatibility Specification

## Purpose

Define what a relay request adds to tool schemas, so that one schema a model behind the relay rejects does not fail the whole request.

## Requirements

### Requirement: A relay request types untyped string enums

A request to a relay SHALL add `type: "string"` to every schema in its tools whose `enum` holds
only strings and which has no `type`, on every API the extension supports. It SHALL leave every
other schema unchanged, and SHALL not change the requests of providers that are not relays.

#### Scenario: An untyped string enum on a relay

- **WHEN** a tool parameter is `{ "enum": ["pending", "done"] }` and the model is on a relay
- **THEN** the request carries `{ "type": "string", "enum": ["pending", "done"] }`

#### Scenario: An enum that is not only strings

- **WHEN** a tool parameter's `enum` is empty or holds a value that is not a string
- **THEN** the request carries that parameter unchanged

#### Scenario: A provider that is not a relay

- **WHEN** a tool parameter is `{ "enum": ["pending", "done"] }` and the model is on another provider
- **THEN** the request carries that parameter unchanged
