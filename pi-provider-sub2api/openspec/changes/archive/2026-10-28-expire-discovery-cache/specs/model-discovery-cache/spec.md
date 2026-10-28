# model-discovery-cache Spec Delta

## MODIFIED Requirements

### Requirement: Startup uses a matching cache

When a cache entry matches the provider name, normalized base URL, configured API, and xAI flag and is younger than 12 hours, startup and `/reload` SHALL register those models without requesting `/v1/models` or the Codex manifest. Billing and quota requests SHALL still run. A missing, unreadable, or non-matching cache SHALL fetch as before. A successful empty discovery SHALL be cached with its discovery time and reused while it remains younger than 12 hours.

#### Scenario: Second startup

- **WHEN** a matching cache exists and is younger than 12 hours
- **THEN** the extension registers those models, including their reasoning levels, without a discovery request

#### Scenario: Endpoint change

- **WHEN** the provider's base URL or API no longer matches the cached entry
- **THEN** the extension ignores that entry and fetches again

### Requirement: Manual refresh

The extension SHALL register `/sub2api-refresh`. The command SHALL fetch every configured relay even when its cache is younger than 12 hours, replace each successful result in the cache, and register those models in the current session. A relay whose fetch fails SHALL keep its last successful cache entry and its current registration, and the command SHALL report the error. Successful relays in the same refresh SHALL still update. Refreshes from one extension instance SHALL run one at a time.

#### Scenario: Partial refresh failure

- **WHEN** one relay's refresh fails and another's succeeds
- **THEN** the failed relay keeps the models from its last successful cache
- **AND** the successful relay's cache and registration update
- **AND** the command reports the failure

#### Scenario: Fresh cache

- **WHEN** the cache for a relay is younger than 12 hours and the user runs `/sub2api-refresh`
- **THEN** the extension fetches that relay again and registers the result

## ADDED Requirements

### Requirement: Expired cache refreshes in the background

A matching cache that is 12 hours old or older, or that has no discovery time, SHALL be registered immediately without waiting for a discovery request. The extension SHALL then refresh that relay in the background. A successful background refresh SHALL update the cache time and the current registrations. A failed background refresh SHALL keep the previous cache, its discovery time, and the current registrations.

#### Scenario: Expired startup

- **WHEN** a matching cache is 12 hours old or older
- **THEN** startup registers those models before the refresh request finishes
- **AND** a successful background refresh replaces them and records a new discovery time

#### Scenario: Failed background refresh

- **WHEN** the background refresh of an expired cache fails
- **THEN** the previously cached models and discovery time remain
