# Design

## Context

`fetchModels` runs inside the extension factory, and Pi waits for that factory before the session starts. Explicit Codex relays read `GET /backend-api/codex/models`. Other relays read `GET /v1/models`, with optional manifest enrichment. xAI entries use only `/v1/models`. Failures today log and register no models. `loadCachedModelMetadata` restores Pi's catalog from `models-store.json` and does not include relay-specific reasoning levels.

## Goals / Non-Goals

- Cache successful discovery results and register them without a discovery request when the provider name, normalized base URL, API, and xAI flag still match.
- Refresh on demand with `/sub2api-refresh`, including a partial failure that keeps the last good entry.
- Keep tokens out of the cache file.

Non-goals: background refresh, caching billing or quota, and changing Pi's catalog cache.

## Decisions

- Store one `sub2api-models.json` beside `sub2api.json`, version 1, mode `0600`, written atomically. A missing, oversized, or invalid file is a cache miss. An invalid provider entry is skipped; other entries remain usable.
- Persist the normalized `DiscoveredModel` fields that registration needs: id, name, context window, output limit, input, reasoning, `supportedThinkingLevels` (the Codex manifest's recognized efforts), and for xAI `remoteMaxTokens` plus `xaiReasoning`. Empty thinking-level arrays are kept because they mean a recognized list with no selectable effort.
- A cache hit still waits for the billing request so the first registration can scale prices. It does not call model or manifest endpoints.
- A cache miss fetches as today and writes only `{ ok: true }` results. Enrichment failure for a non-Codex relay still counts as success and caches the inventory.
- `/sub2api-refresh` fetches every configured relay, stores successes, and re-registers them. Fetch failures leave that relay's registration and cache entry unchanged. Cache-write failures still update the session and are reported. Refreshes from one extension instance run one at a time.
- Thinking levels are stored in the canonical `minimal`…`ultra` order so the file does not depend on manifest order.

## Risks / Trade-offs

- A matching cache can be stale until `/sub2api-refresh`. That is the requested trade for a fast startup.
- A successful empty inventory is cached, so a relay that returns no models stays empty until refresh.
- Billing can still delay startup. Removing that wait would register unscaled prices first.
- `/openai-compress` is still registered from the models known at startup. A refresh that discovers the first Codex model does not add the command until `/reload`.

## Migration Plan

No config migration. The cache file appears after the next successful discovery. Deleting it restores the previous fetch-on-startup behavior.

## Open Questions

None.
