# skill-delivery Specification

## Purpose

Define how a `$skill` block reaches the model together with the words that invoked it, whether the session is idle or the model is answering.

## Requirements

### Requirement: A queued skill arrives with its prompt

A `$skill` submitted while the model is answering SHALL reach the model in the same message as the text that invoked it, block first, using the input's delivery mode, and SHALL NOT take a model turn of its own.

#### Scenario: A steered skill

- **WHEN** `$known now` is steered during a running turn
- **THEN** the next request carries the block followed by `$known now` in one message, and no other request is added

#### Scenario: A follow-up skill

- **WHEN** `$known now` is queued as a follow-up during a running turn
- **THEN** the block and the text wait until the turn ends and then arrive in one message

#### Scenario: A terminal shows the queued skill

- **WHEN** a person types `$known now` while the model is answering
- **THEN** the terminal renders a collapsed `[skill] known` block rather than the raw block text
