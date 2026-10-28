# Tasks

## 1. Cache

- [x] 1.1 Distinguish successful discovery from failure without changing failure logs, and persist successful results in `sub2api-models.json`.
- [x] 1.2 Register a matching cache on startup without a discovery request, and fetch when the cache is missing, invalid, or does not match the endpoint.
- [x] 1.3 Add `/sub2api-refresh` to update the cache and current registrations, keeping the last success when a relay fails.

## 2. Documentation and release

- [x] 2.1 Document the cache file, startup behavior, and `/sub2api-refresh` in the package README and the root package table.
- [x] 2.2 Record a minor release intent for `@indexyz/pi-provider-sub2api`.

## 3. Verification

- [x] 3.1 Cover cache reuse, Codex reasoning levels, xAI metadata, endpoint mismatch, corrupt cache, failed discovery, and partial refresh with package tests.
- [x] 3.2 Run `npm run check`, the Pi 1.4.0 RPC load smoke test, and the release-impact gate.
