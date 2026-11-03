# Tasks

## 1. Startup

- [x] 1.1 Add a `CacheStore` that reads each file once and serializes and coalesces writes per file.
- [x] 1.2 Register matching caches immediately, fetch providers without a usable cache concurrently, and refresh expired sources in the background after `session_start`.

## 2. models.dev

- [x] 2.1 Index catalog lookups per record without changing match precedence.
- [x] 2.2 Trim the stored catalog to the fields enrichment reads and write cache files compactly.

## 3. Documentation and release

- [x] 3.1 Document the startup and refresh behavior in the package README.
- [x] 3.2 Record a minor release intent for `@indexyz/pi-custom-provider`.

## 4. Verification

- [x] 4.1 Cover expired-cache registration before refresh, background success and failure, and concurrent first fetch through the real host.
- [x] 4.2 Run `npm run check`, the RPC load smoke test, and the startup profile against the real cache.
