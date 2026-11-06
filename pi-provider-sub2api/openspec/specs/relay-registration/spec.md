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

### Requirement: Shared runtime shutdown keeps relays another session still holds

Shutting down one extension instance SHALL release only the relays no other live instance still registered on the same model runtime. A relay that remains SHALL still accept a request from the surviving session. A relay only the shutting-down instance registered SHALL be removed.

#### Scenario: Child session shuts down

- **WHEN** a child session has loaded the extension against its parent's model runtime and the child session shuts down
- **THEN** a request with the parent's selected relay model reaches the relay

#### Scenario: Relay only the child registered

- **WHEN** a child session registered a relay the parent session did not, and the child session shuts down
- **THEN** that relay's model is gone and the parent's relay still reaches the relay

#### Scenario: Load without a session

- **WHEN** the extension is loaded and no session starts or shuts down, and a later session reloads without that relay
- **THEN** the relay is not available for a request
