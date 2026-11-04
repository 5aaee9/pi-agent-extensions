# Tasks

## 1. Fix

- [x] 1.1 Add the retry matrix to `scripts/e2e/pi/pi-provider-sub2api-retry.e2e.ts` and observe all three `stream_read_error` shapes end after one attempt before the fix.
- [x] 1.2 Normalize the error in `streamCodex`; verify all three shapes reach a second attempt and succeed, a permanent failure stays at one attempt, and overflow recovery still replays the native checkpoint.
- [x] 1.3 Correct the README retry and compaction timeout statements.
- [x] 1.4 Record a `patch` intent for `@indexyz/pi-provider-sub2api`.
