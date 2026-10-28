# Proposal

## Why

Startup and `/reload` wait on remote model discovery, which is slow on high-latency links. Pi's `models-store.json` catalog does not contain the relay inventory or Codex `supported_reasoning_levels`, so a separate local cache of discovery results is needed.

## What Changes

- Persist each successful relay discovery, including context windows, output limits, and reasoning metadata, in `sub2api-models.json`.
- On later startups, register a matching cache entry without calling `/v1/models` or the Codex manifest.
- Fetch automatically when no matching cache exists. Do not store a failed discovery.
- Add `/sub2api-refresh` to fetch again, update the cache, and re-register models. A failed relay keeps its last successful cache and registration.
- Leave billing and quota requests on their current startup path.

## Capabilities

### New Capabilities

- `model-discovery-cache`: Local reuse of relay discovery results and the manual refresh command.

### Modified Capabilities

- `xai-relay`: An xAI entry reuses its last successful `/v1/models` inventory from the discovery cache until refresh. Pi catalogs remain metadata, not inventory.

## Impact

- `pi-provider-sub2api` discovery, provider registration, README, and tests. No new dependency and no change to request, quota, or credential behavior.
- Published files change, so `@indexyz/pi-provider-sub2api` needs a minor release intent. The cache file lives in the agent directory and is not part of the package.
