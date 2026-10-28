# model-discovery-cache Spec Delta

## ADDED Requirements

### Requirement: Persistent discovery cache

The extension SHALL store each successful relay discovery in `sub2api-models.json` in the agent directory. A stored entry SHALL include the provider identity, normalized endpoint, and the model metadata used for registration. Codex reasoning levels and xAI reasoning metadata SHALL be included. The file SHALL NOT contain tokens. Pi's `models-store.json` catalog SHALL remain a separate source.

#### Scenario: Successful Codex discovery

- **WHEN** an explicit Codex relay returns a manifest with context window, output limit, and `supported_reasoning_levels`
- **THEN** those values are written to `sub2api-models.json` without the relay token
- **AND** the registered model uses that context window, output limit, and thinking levels

#### Scenario: Failed discovery

- **WHEN** discovery fails and no matching cache entry exists
- **THEN** the extension registers no models for that relay, reports the failure, and does not create or replace a cache entry

### Requirement: Startup uses a matching cache

When a cache entry matches the provider name, normalized base URL, configured API, and xAI flag, startup and `/reload` SHALL register those models without requesting `/v1/models` or the Codex manifest. Billing and quota requests SHALL still run. A missing, unreadable, or non-matching cache SHALL fetch as before. A successful empty discovery SHALL be cached and reused.

#### Scenario: Second startup

- **WHEN** a matching cache exists from a previous successful discovery
- **THEN** the extension registers those models, including their reasoning levels, without a discovery request

#### Scenario: Endpoint change

- **WHEN** the provider's base URL or API no longer matches the cached entry
- **THEN** the extension ignores that entry and fetches again

### Requirement: Manual refresh

The extension SHALL register `/sub2api-refresh`. The command SHALL fetch every configured relay, replace each successful result in the cache, and register those models in the current session. A relay whose fetch fails SHALL keep its last successful cache entry and its current registration, and the command SHALL report the error. Successful relays in the same refresh SHALL still update. Refreshes from one extension instance SHALL run one at a time.

#### Scenario: Partial refresh failure

- **WHEN** one relay's refresh fails and another's succeeds
- **THEN** the failed relay keeps the models from its last successful cache
- **AND** the successful relay's cache and registration update
- **AND** the command reports the failure
