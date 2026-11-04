# Spec Delta

## ADDED Requirements

### Requirement: Offline mode sends no automatic request

Under `--offline` or a truthy `PI_OFFLINE`, the extension SHALL send no provider discovery and no models.dev request on its own: neither at startup nor as a background refresh. It SHALL register what it has without the network. Requests a user asks for, such as `/refresh-custom-provider-models`, SHALL be unaffected.

#### Scenario: Cold start offline

- **WHEN** Pi starts offline with models.dev enabled and no cache
- **THEN** no request reaches the provider's models endpoint or the models.dev endpoints
- **AND** the provider's `fallbackModels` are registered

#### Scenario: Expired caches offline

- **WHEN** Pi starts offline with expired provider and models.dev caches
- **THEN** the cached models are registered
- **AND** no refresh request follows `session_start`
