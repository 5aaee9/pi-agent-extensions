# native-auth Specification

## Purpose

Define how a configured key, including one produced by a command, reaches a provider as a bearer token when the provider's configuration asks for it.

## Requirements

### Requirement: A command-sourced key reaches the provider as a bearer token

With `authHeader: "authorization"`, a key given as `!command` SHALL reach the provider as `Authorization: Bearer <command output>`, on every native API and on `ollama-chat`.

#### Scenario: A native API with a command-sourced key

- **WHEN** a provider on `openai-completions`, `openai-responses`, or `anthropic-messages` sets `apiKey` to a command and `authHeader` to `authorization`
- **THEN** the chat request carries the command's output as a bearer token

#### Scenario: Ollama with a command-sourced key

- **WHEN** a provider on `ollama-chat` sets `apiKey` to a command and `authHeader` to `authorization`
- **THEN** the chat request carries the command's output as a bearer token
