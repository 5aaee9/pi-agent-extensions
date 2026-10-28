# Tasks

## 1. Lifetime

- [x] 1.1 Store a discovery time and treat a cache 12 hours old or older, or missing a time, as expired.
- [x] 1.2 Register an expired cache immediately and refresh it in the background. Keep the previous cache when that refresh fails.
- [x] 1.3 Make `/sub2api-refresh` fetch even when the cache is younger than 12 hours.

## 2. Documentation

- [x] 2.1 Describe the 12-hour lifetime, background refresh, and forced command in the package README.
- [x] 2.2 Update the pending release summary for `@indexyz/pi-provider-sub2api`.
