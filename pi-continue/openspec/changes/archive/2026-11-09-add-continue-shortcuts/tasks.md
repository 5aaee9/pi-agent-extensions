# Tasks

## 1. Share the retry between the command and the shortcuts

- [x] 1.1 Move the `/continue` body into one `continueTurn()` that takes the base context, keeping the argument validation in the command handler.
- [x] 1.2 Register `f5` and `alt+r`, each running `continueTurn()`; wait for idle by polling `isIdle()` when the context has no `waitForIdle()`.

## 2. Prove it through the host

- [x] 2.1 Add terminal scenarios to `scripts/e2e/pi/pi-continue.e2e.ts`: `F5` and `Alt+R` each retry a failed turn from the preceding user message, and the same key after the retried turn completes starts nothing and shows the "No interrupted or failed turn" notice.
- [x] 2.2 Observe the scenarios fail before the registration (no retry happens), then pass with it.

## 3. Ship

- [x] 3.1 Update `README.md` with the keys and their relationship to omp's `app.retry`.
- [x] 3.2 Record a `minor` intent for `@indexyz/pi-continue`.
- [x] 3.3 Verify: package `check`, `oxfmt --check`, `oxlint`, and the `pi-continue` e2e scenarios.
