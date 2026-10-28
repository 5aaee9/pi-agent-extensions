## Why

A fresh model cache still waits on `GET /v1/sub2api/billing` before startup can register models. That multiplier is the registered model price, so it belongs in the same cache as the model list.

## What Changes

- Store the billing price multiplier in `sub2api-models.json` with the discovered models.
- When that entry is younger than 12 hours and includes a multiplier, register scaled prices without a billing request.
- When the entry is expired, or the multiplier is missing, register immediately and refresh in the background. A failed refresh keeps the last multiplier.
- Make `/sub2api-refresh` fetch the multiplier even while the cache is fresh.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-discovery-cache`: The discovery cache also stores the price multiplier and shares its 12-hour lifetime.

## Impact

- `pi-provider-sub2api` cache format, startup, `/sub2api-refresh`, README, and tests. No new dependency.
