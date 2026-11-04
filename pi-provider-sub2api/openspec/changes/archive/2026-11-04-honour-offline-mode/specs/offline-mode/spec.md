# Spec Delta

## Purpose

Define which relay requests the extension sends under Pi's offline mode, so `--offline` and `PI_OFFLINE=1` hold for this package as Pi documents them.

## ADDED Requirements

### Requirement: Offline mode suppresses automatic requests

Under `--offline` or `PI_OFFLINE=1`, the extension SHALL send no discovery, billing, or usage request by itself.

#### Scenario: Cold start

- **WHEN** Pi starts offline with a configured relay and no discovery cache
- **THEN** the relay receives no request and registers no models

#### Scenario: Prompt from a stale cache

- **WHEN** Pi starts offline with an expired discovery cache and the user sends one prompt
- **THEN** the cached models stay available, and the model request is the only request the relay receives

### Requirement: Requests the user asks for still go out

Offline mode SHALL NOT suppress model requests or `/sub2api-refresh`.

#### Scenario: Manual refresh

- **WHEN** the user runs `/sub2api-refresh` offline
- **THEN** discovery reaches the relay and its models are registered
