## Context

`refreshRelayBilling` reads `effective_rate_multiplier` and `registerRelayProvider` applies it with `scaleModelCost`. It changes registered model prices, not the usage footer. The footer still loads quota separately and already shows `loading…` until usage arrives.

## Goals / Non-Goals

**Goals:**

- Keep the multiplier in the same `sub2api-models.json` entry as the models, under the same 12-hour `fetchedAt`.
- Register cached models and the saved multiplier without waiting for billing.
- Refresh an expired entry's models and multiplier together. Refresh only billing when the models are fresh but the multiplier was never stored.
- Keep the last multiplier when billing fails. HTTP 404 and 405 store `1`.

**Non-Goals:**

- Caching quota or usage-footer rows.
- A second cache file or a separate billing TTL.

## Decisions

- One timestamp covers models and the multiplier. A young entry with `priceMultiplier` skips billing on startup and on later quota refreshes. `/sub2api-refresh` always fetches both.
- Entries written before this field register at multiplier `1` and request billing in the background. That request does not rediscover models.
- A failed billing response does not erase a stored multiplier. `not-found` is a completed lookup and stores `1`.

## Risks / Trade-offs

- Peak or plan changes stay at the cached multiplier until the entry expires or `/sub2api-refresh` runs.
- A model refresh that succeeds while billing fails keeps the previous multiplier and marks the entry fresh, so billing is not retried until expiry or a forced refresh.

## Migration Plan

- Old cache entries remain valid. Missing `priceMultiplier` means the rate is not known yet.

## Open Questions

- None.
