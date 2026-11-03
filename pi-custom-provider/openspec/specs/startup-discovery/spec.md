# startup-discovery Specification

## Purpose

TBD - created by archiving change fast-cached-startup. Update Purpose after archive.

## Requirements

### Requirement: Cached models register without waiting for the network

When a provider's cache entry matches its API, base URL, and models URL, loading the extension SHALL register those models without a discovery request, whether or not the entry is older than the provider's TTL. When an existing models.dev catalog is cached, startup SHALL enrich from it without a models.dev request, whatever its age.

#### Scenario: Expired provider cache

- **WHEN** the matching cache entry is older than its TTL
- **THEN** the extension registers the cached models before any request to the provider

#### Scenario: No usable cache

- **WHEN** a provider has no matching cache entry
- **THEN** loading fetches its models and waits for the result, falling back to `fallbackModels` as before

### Requirement: Expired sources refresh in the background

After `session_start`, the extension SHALL refresh each expired provider cache and an expired models.dev catalog without blocking, and SHALL register the refreshed models in the running session. A failed refresh SHALL keep the registered models and the cache entry. Background refresh SHALL run once per extension instance and SHALL stop registering after `session_shutdown`.

#### Scenario: Background refresh succeeds

- **WHEN** an expired provider refreshes successfully after `session_start`
- **THEN** the cache entry and the session's model registry contain the new models

#### Scenario: Background refresh fails

- **WHEN** the provider's refresh request fails
- **THEN** the session keeps the cached models and the cache entry keeps its models

### Requirement: Shared cache files stay consistent

Providers and models.dev that share a cache file SHALL all be kept in it after concurrent fetches. The models.dev catalog SHALL be stored with only the fields enrichment reads.

#### Scenario: Concurrent first fetch

- **WHEN** two providers using the default cache file both fetch on startup
- **THEN** the cache file contains both providers' entries
