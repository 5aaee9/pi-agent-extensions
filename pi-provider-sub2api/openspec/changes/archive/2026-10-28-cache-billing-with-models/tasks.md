## 1. Cache the price multiplier with the models

- [x] 1.1 Store `priceMultiplier` on the discovery cache entry and reuse it while the entry is younger than 12 hours.
- [x] 1.2 Register cached models without waiting for billing, and refresh a missing or expired multiplier in the background.
- [x] 1.3 Make `/sub2api-refresh` fetch the multiplier even when the cache is fresh, and keep the last multiplier when billing fails.

## 2. Documentation and verification

- [x] 2.1 Document the shared cache in the package README.
- [x] 2.2 Cover fresh reuse, a missing multiplier, a failed refresh, and a forced refresh with tests.
