# Test audit: all packages

| Package                                 | Cases | Removed | Left |
| --------------------------------------- | ----- | ------- | ---- |
| `dsh-autocompact`                       | 53    | 8       | 45   |
| `dsh-custom-provider-reasoning-efforts` | 168   | 51      | 117  |
| `dsh-prompt-suggestions`                | 64    | 15      | 49   |
| `dsh-thread-summary`                    | 33    | 7       | 26   |
| Total                                   | 318   | 81      | 237  |

Each `it` or `it.each` call counts as one case.

Regression guard: `does not statically import the removed serviceForAgent export` guarded the bug fixed in `d49174c`. `loads the built host entry as installed ESM against the real registry` was observed failing when that named import was added back, so the source check was removed.

Removed tests that were vacuous leave these paths uncovered, as they already were in practice:

- `discoverRoutes` in `dsh-custom-provider-reasoning-efforts`.
- The `menuOpen` gate on Tab in `dsh-prompt-suggestions`.

The `includes("image")` gate for a text-only listing stays covered by `discovers the modalities a listing publishes for a declared vision model`.

## Pi packages

Counts are test runs, with each `it.each` row counted once. The Left column is observed from each package's run; Before is Left plus the audited removals.

| Package               | Before | Removed | Left |
| --------------------- | ------ | ------- | ---- |
| `pi-ask`              | 136    | 14      | 122  |
| `pi-autocompact`      | 95     | 35      | 60   |
| `pi-continue`         | 7      | 0       | 7    |
| `pi-custom-provider`  | 54     | 0       | 54   |
| `pi-idle-compression` | 25     | 4       | 21   |
| `pi-model-trace`      | 12     | 1       | 11   |
| `pi-provider-sub2api` | 97     | 23      | 74   |
| `pi-skill`            | 13     | 3       | 10   |
| Total                 | 439    | 80      | 359  |

The tests of `pi-ask`'s Pi 1.4.0 status fallback are exempt and unchanged.

Six regression guards were kept because their replacements have not been observed detecting the bug:

- `pi-ask`: `pending ask scan ignores tool results and persisted dismissals`, `submitted results surface every question when all are unanswered`.
- `pi-continue`: `retries a provider error with the newly selected model`.
- `pi-custom-provider`: `uses a fresh cache without a network request and registers an expired cache without waiting`.
- `pi-idle-compression`: `ends the idle period when manual compaction is cancelled`.
- `pi-provider-sub2api`: `renders cache hit rate for empty session`.

Some removed cases now rely on scenarios in `scripts/e2e/pi/` for their coverage, so those paths are verified by `npm run test:e2e:pi` rather than by the package's own tests.

## Rule applied

Removed tests were judged by reading against `real-environment-testing`: each one repeats a path another test in the package asserts, or a failure a scenario covers whose detection is recorded under `2026-11-04-replace-low-value-pi-tests-with-e2e/verification/`. Targeted mutations settled three removals reviewers challenged: dropping the `allowFreeform` gate fails `branch payload lookup allows freeform only for answer extraction payloads`, dropping the initial save in `loadMissingConfig` fails `config store uses defaults when initial config creation fails`, and dropping the `!skill` guard in `pi-skill` fails `passes through input without $ or without matching skills`.

Only the test-value rule was applied to dsh. The existing dsh tests that call a package's own logic on plain data predate the spec's "A dsh package test has none of these exceptions" and were not changed; whether dsh should have the same exception as Pi is an open owner decision.
