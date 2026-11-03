# Proposal

## Why

Loading the extension awaits model discovery for every provider before Pi can continue starting. A cache older than its TTL waits for the network, serially per provider, before anything is registered. Even with a fresh cache, a measured startup against a real 12.6 MB cache spent about 120 ms reading and parsing the file, most of it the models.dev catalog, and about 350 ms enriching 109 models, because each lookup scans every models.dev provider with a case-insensitive linear search.

## What Changes

- A matching provider cache, fresh or expired, is registered immediately. Expired entries refresh in the background after `session_start`, and the refreshed models are registered in the running session. A failed background refresh keeps the cached models.
- The models.dev catalog follows the same rule: an existing catalog, fresh or expired, enriches startup models; an expired one refreshes in the background and re-registers the providers that use it.
- A provider with no matching cache, or a first run with no models.dev cache, fetches and waits as before.
- Providers without a usable cache fetch concurrently. Writes to a shared cache file are serialized and coalesced, so concurrent providers cannot overwrite each other.
- models.dev lookups use a per-catalog index instead of linear scans; matching results stay the same.
- The cached models.dev catalog keeps only the fields enrichment reads, and the cache file is written without indentation.
- `/refresh-custom-provider-models` still fetches everything and waits for it.

## Capabilities

### New Capabilities

- `startup-discovery`: How startup chooses between the cache, background refresh, and blocking discovery, and how cache files are written.

## Impact

- `pi-custom-provider` startup wiring, cache, discovery, models.dev modules, tests, and README. No new dependency, configuration key, or command.
- Published files change, so `@indexyz/pi-custom-provider` needs a minor release intent.
