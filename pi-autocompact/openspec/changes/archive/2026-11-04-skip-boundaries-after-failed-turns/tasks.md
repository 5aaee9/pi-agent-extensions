# Tasks

## 1. Fix

- [x] 1.1 Add scenario "a failed turn sends no paid summary, and the next successful turn compacts" and observe it fail before the fix.
- [x] 1.2 Return early from `checkBoundary` unless `event.outcome` is `completed`; verify the scenario passes and the other boundary scenarios still do.
- [x] 1.3 Document it in the README; record a `patch` intent for `@indexyz/pi-autocompact`.
