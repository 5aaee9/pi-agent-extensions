# Design

## Context

Successful discovery is stored in `sub2api-models.json` and reused whenever the provider, base URL, API, and xAI flag match. The manual command already fetches every relay. The factory is awaited by Pi, so a refresh that must not delay startup cannot be awaited there.

## Goals / Non-Goals

- Keep a matching cache for 12 hours without a discovery request.
- After that, register the cached models immediately and refresh in the background.
- Let `/sub2api-refresh` fetch immediately at any age.

Non-goals: refreshing on a timer while Pi stays open, and changing billing or quota.

## Decisions

- Store `fetchedAt` as Unix milliseconds on each provider entry. A missing or invalid timestamp is expired, so entries written before this field still refresh once. An age of exactly 12 hours is expired.
- `get` reports `fresh` from `now - fetchedAt < 12 hours`. Callers register `models` either way when the endpoint matches.
- Background refresh uses the same serialized queue as `/sub2api-refresh`, so a forced command waits for an in-flight refresh and then fetches again. The factory starts that work without awaiting it. Results are applied only while the extension generation is still current. Failure leaves the previous models and timestamp in place.
- Background failures are logged. The command still reports success and failure through the UI.

## Risks / Trade-offs

- An expired list is visible until the background fetch finishes.
- A process that exits immediately after loading extensions may not finish the background fetch. The next startup tries again.

## Migration Plan

Existing cache files stay valid. Entries without `fetchedAt` refresh in the background on the next startup.

## Open Questions

None.
