# Tasks

## 1. Stop the wait from outliving the press

- [x] 1.1 Refuse a shortcut while the agent is busy, unless the current run is being aborted.
- [x] 1.2 Keep `/continue` waiting for idle through `waitForIdle()`.

## 2. Prove it through the host

- [x] 2.1 Add a terminal scenario for a shortcut during a running turn followed by Esc, seen failing before the fix.
- [x] 2.2 Add a terminal scenario for a shortcut while an abort is settling.

## 3. Ship

- [x] 3.1 Document the behaviour in `README.md`.
- [x] 3.2 Record a `patch` intent for `@indexyz/pi-continue`.
- [x] 3.3 Fix what the shortcut scenarios left failing in root `format:check`, `lint:tooling`, and `tsc`.
