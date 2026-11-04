# answer-extraction Specification

## Purpose

Define which model `/answer` uses to extract questions from the latest assistant message.

## Requirements

### Requirement: Extraction uses a model with real credentials

`/answer` SHALL select the first configured extraction model in the session's model scope that has credentials, and otherwise the chat model. A model on a provider with no credentials SHALL NOT be selected, whether or not the provider requires an auth header.

#### Scenario: Only the chat model has credentials

- **WHEN** `/answer` runs on the default configuration and none of the default extraction models has credentials
- **THEN** the extraction request goes to the chat model, the user is told the chat model is used, and the form opens

#### Scenario: A configured model has credentials

- **WHEN** the configured extraction models list providers without credentials before one with credentials
- **THEN** the extraction request goes to the first model that has credentials, with no fallback notice

#### Scenario: A configured model is outside the session's scope

- **WHEN** a configured extraction model has credentials but `--models` excludes it
- **THEN** it is skipped for the next configured model

#### Scenario: The chat model has no credentials

- **WHEN** no configured model is usable and the chat model's provider has no credentials
- **THEN** `/answer` reports `No auth for fallback chat model` with the model's name, and no model request is sent

#### Scenario: The chat model is outside the session's scope

- **WHEN** no configured model is usable and `--models` excludes the chat model
- **THEN** `/answer` reports that no extraction model is available in the session's scope, and no model request is sent

### Requirement: The settings overlay names this package

The `/ask-settings` overlay SHALL show `@indexyz/pi-ask` as its header.

#### Scenario: Settings are opened

- **WHEN** the user runs `/ask-settings` in a terminal
- **THEN** the overlay's header reads `@indexyz/pi-ask`
