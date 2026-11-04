# Tasks

## 1. Fix

- [x] 1.1 Add the offline assertions to `scripts/e2e/pi/pi-provider-sub2api-cache.e2e.ts` and observe discovery, billing, and usage requests reach the relay before the fix.
- [x] 1.2 Suppress automatic requests offline; verify none reach the relay under `--offline` or `PI_OFFLINE=1` on a cold start, and across one prompt from a stale seeded cache, whose model request still goes through and whose models stay available.
- [x] 1.3 Verify `/sub2api-refresh` still reaches the relay offline, and document the behavior in the README.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-provider-sub2api`.
