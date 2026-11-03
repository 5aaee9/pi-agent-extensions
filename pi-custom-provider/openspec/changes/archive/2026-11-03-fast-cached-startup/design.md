# Design

## Startup

The factory reads each distinct cache file once and classifies every source:

| Source state                                     | Startup                       | After `session_start` |
| ------------------------------------------------ | ----------------------------- | --------------------- |
| Matching cache within TTL                        | Use cache                     | Nothing               |
| Matching cache past TTL                          | Use cache                     | Refresh in background |
| No matching cache (missing, other endpoint, off) | Fetch and wait (concurrently) | Nothing               |

models.dev is classified the same way. Providers are enriched and registered once all blocking fetches finish.

Background work starts in `session_start` because Pi may load extensions without starting a session (`docs/extensions.md`, "Long-lived resources and shutdown"). It runs once per extension instance; `session_shutdown` aborts it, and nothing is registered after the abort. Pi 0.84.0 applies `registerProvider` calls made after load immediately.

A background refresh that fails keeps the models already registered; `discoverProvider` and `loadModelsDevCatalog` already fall back to the cache and log a warning. When models.dev refreshes, every provider that uses models.dev is re-enriched and re-registered.

## Cache writes

A `CacheStore` owns the in-memory document per file. All sources sharing a file mutate the same document, and `write(path)` chains writes per file: while one write runs, further requests collapse into a single follow-up write of the latest document. This replaces the previous serial processing, which existed only to avoid lost updates.

## models.dev

`findModelsDevModel` keeps its precedence order. A `WeakMap` keyed by the catalog's records holds a lowercase-key map per record, built on first use, so the exact lookup stays a property access and the case-insensitive fallback becomes a map lookup that returns the same first match as `Object.entries().find`.

The stored catalog keeps provider `models`, and per model `name`, `reasoning`, `reasoning_options`, `limit`, `modalities`, `cost`, and `pricing`, which are all the fields enrichment reads. Older full caches are trimmed when read, so the next write already shrinks the file. Measured on the real cache: 12.6 MB indented becomes 2.8 MB compact.
