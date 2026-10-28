# model-discovery-cache Spec Delta

## MODIFIED Requirements

### Requirement: Persistent discovery cache

The extension SHALL store each successful relay discovery in `sub2api-models.json` in the agent directory. A stored entry SHALL include the provider identity, normalized endpoint, model metadata used for registration, and, once billing has completed, the price multiplier. Codex reasoning levels and xAI reasoning metadata SHALL be included. The file SHALL NOT contain tokens. Pi's `models-store.json` catalog SHALL remain a separate source.

#### Scenario: Successful Codex discovery

- **WHEN** an explicit Codex relay returns a manifest with context window, output limit, and `supported_reasoning_levels`
- **THEN** those values are written to `sub2api-models.json` without the relay token
- **AND** the registered model uses that context window, output limit, and thinking levels

#### Scenario: Failed discovery

- **WHEN** discovery fails and no matching cache entry exists
- **THEN** the extension registers no models for that relay, reports the failure, and does not create or replace a cache entry

### Requirement: Startup uses a matching cache

When a matching cache is younger than 12 hours, startup and `/reload` SHALL register its models without requesting `/v1/models`, the Codex manifest, or billing. A stored multiplier SHALL scale prices immediately. A missing multiplier SHALL use standard prices and refresh billing in the background. Quota requests SHALL still run. A missing, unreadable, or non-matching cache SHALL fetch as before. An empty discovery SHALL be cached and reused while younger than 12 hours.

#### Scenario: Second startup

- **WHEN** a matching cache exists, is younger than 12 hours, and includes a price multiplier
- **THEN** the extension registers those models at that multiplier without a discovery or billing request

#### Scenario: Endpoint change

- **WHEN** the provider's base URL or API no longer matches the cached entry
- **THEN** the extension ignores that entry and fetches again

### Requirement: Manual refresh

The extension SHALL register `/sub2api-refresh`. The command SHALL fetch every relay's models and price multiplier even when its cache is younger than 12 hours, store each success, and register those models. A failed model fetch SHALL keep that relay's last models and multiplier. A billing failure SHALL keep the last multiplier. The command SHALL report the error. Other relays SHALL still update. Refreshes from one extension instance SHALL run one at a time.

#### Scenario: Partial refresh failure

- **WHEN** one relay's refresh fails and another's succeeds
- **THEN** the failed relay keeps the models from its last successful cache
- **AND** the successful relay's cache and registration update
- **AND** the command reports the failure

#### Scenario: Fresh cache

- **WHEN** the cache for a relay is younger than 12 hours and the user runs `/sub2api-refresh`
- **THEN** the extension fetches that relay's models and price multiplier again and registers the result

### Requirement: Expired cache refreshes in the background

A matching cache that is 12 hours old or older, or that has no discovery time, SHALL be registered immediately, using its stored multiplier when present, without waiting for discovery or billing. The extension SHALL then refresh that relay's models and multiplier in the background. A successful background refresh SHALL update the cache time, multiplier, and current registrations. A failed background refresh SHALL keep the previous models, multiplier, and discovery time.

#### Scenario: Expired startup

- **WHEN** a matching cache is 12 hours old or older
- **THEN** startup registers those models before the refresh request finishes
- **AND** a successful background refresh replaces them and records a new discovery time

#### Scenario: Failed background refresh

- **WHEN** the background refresh of an expired cache fails
- **THEN** the previously cached models, price multiplier, and discovery time remain
