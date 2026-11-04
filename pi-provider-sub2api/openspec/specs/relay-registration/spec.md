# relay-registration Specification

## Purpose

Define how a relay's registration in Pi follows its configuration across `/reload` and `/sub2api-refresh`, so no stale handler or credential survives.

## Requirements

### Requirement: Reload replaces the previous registration

After `/reload`, the extension SHALL leave only the current configuration's registrations in Pi, with the current token and the handler for the configured API.

#### Scenario: Token rotated

- **WHEN** a relay's token changes and Pi reloads
- **THEN** the next model request carries only the new token

#### Scenario: API switched away from Codex

- **WHEN** a relay changes its token and its API from `openai-codex-responses` to `openai-responses`, and Pi reloads
- **THEN** every later request to the relay carries the new token and the model request is not sent by the Codex adapter

#### Scenario: Relay removed

- **WHEN** a relay is removed from `sub2api.json` and Pi reloads
- **THEN** its models are not listed and a prompt sends the relay nothing

### Requirement: Refresh replaces a stale handler

A registration made by `/sub2api-refresh` SHALL drop the Codex handler when no model of the relay uses Codex any more.

#### Scenario: Last Codex model disappears

- **WHEN** an automatically routed relay's inventory no longer lists a Codex model and the user runs `/sub2api-refresh`
- **THEN** the next model request on a remaining model is not sent by the Codex adapter

### Requirement: Reload aborts in-flight usage requests

The extension SHALL abort an in-flight usage request when Pi reloads.

#### Scenario: Usage request held by the relay

- **WHEN** a usage request is in flight and Pi reloads
- **THEN** the relay sees the client abandon the request

### Requirement: Session replacement keeps registrations

A new session SHALL keep the relay's models available.

#### Scenario: New session

- **WHEN** the user starts a new session on a relay model
- **THEN** the model stays selected and its next request reaches the relay with the configured token
