# Proposal

## Why

A discovery cache that never expires can keep serving a model list after the relay has changed. Startup should stay fast, and a manual command should still be able to fetch immediately.

## What Changes

- Record the time of each successful discovery and treat entries 12 hours old or older as expired.
- Register an expired cache immediately, then refresh that relay in the background. A failed background refresh keeps the previous cache.
- Make `/sub2api-refresh` force a fetch even when the cache is younger than 12 hours.

## Capabilities

### New Capabilities

### Modified Capabilities

- `model-discovery-cache`: Add a 12-hour lifetime and a background refresh for expired entries. The manual command ignores that lifetime.
- `xai-relay`: An xAI inventory cache follows the same lifetime. A fresh cache skips `GET /v1/models`; an expired cache is registered immediately and refreshed in the background.

## Impact

- `pi-provider-sub2api` cache format, startup, `/sub2api-refresh`, README, and tests. No new dependency. The pending minor release intent for this package covers the behavior.
