# xai-relay Spec Delta

## MODIFIED Requirements

### Requirement: Authoritative chat inventory

An xAI entry SHALL use `GET /v1/models` as its only remote inventory and SHALL reuse a matching discovery cache until `/sub2api-refresh`. Registered IDs SHALL stay unchanged. Only chat models from that inventory or cache SHALL be registered; Pi catalogs SHALL supply metadata, not models. A failed discovery with no cache SHALL write nothing. A failed refresh SHALL keep the last cache.

#### Scenario: Unfamiliar text alias

- **WHEN** the inventory advertises a valid unfamiliar text alias
- **THEN** it remains selectable with its exact ID and the xAI entry behavior

#### Scenario: Missing inventory

- **WHEN** no matching discovery cache exists and the inventory request fails, returns malformed data, or contains no valid IDs
- **THEN** that entry registers no discovered models, reports a failure when appropriate, and does not substitute local catalog models

#### Scenario: Cached inventory

- **WHEN** a previous successful inventory is cached for the same xAI entry
- **THEN** startup registers those models without calling `GET /v1/models`
- **AND** `/sub2api-refresh` fetches the inventory again
- **AND** a failed refresh keeps the cached models
