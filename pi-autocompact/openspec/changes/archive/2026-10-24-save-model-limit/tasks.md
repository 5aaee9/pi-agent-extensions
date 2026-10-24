# Tasks

## 1. Command grammar and settings merge

- [x] 1.1 Parse `/autocompact` arguments so a numeric threshold accepts one `--save` in either position, and `off`, `default`, a bare query, a repeated flag, an unknown option, or an extra token with `--save` is an error. Verify with unit tests for accepted forms (`300k`, `0.3m`, `300000`, `--save` before or after) and the rejected combinations.
- [x] 1.2 Merge one `provider/modelId` integer into `piAutocompact.modelLimits` without mutating the input or dropping other keys, and write it to the user settings path under Pi's `settings.json.lock` directory with a temp file, fsync, and rename. Verify a missing file is created, an existing file keeps unrelated keys and its mode, malformed JSON and a non-object `modelLimits` throw without changing bytes, and the lock directory is gone afterward.

## 2. Command wiring

- [x] 2.1 Apply `--save` only after the existing threshold and native-compaction checks, then set the session override and the in-memory default for that model. Without `--save`, do not call the writer. Verify handler tests: `300k` does not write and still compacts; `300k --save` writes `provider/model` = 300000 and still compacts; `default` after a successful save still compacts; `off --save`, `--save`, and an over-window threshold do not write and do not change the previous override.
- [x] 2.2 Report a successful save as stored for the model, and keep "No settings written." for every other successful invocation. Verify the handler notification tests.

## 3. Docs and release decision

- [x] 3.1 Document `--save`, the user settings key, the session-only path, and that a later session start loads the saved default without `/reload` while a hand edit during a running session is picked up at the next session start. Update the package README, the root package table, and the package changelog. Verify the documented commands match the parser tests.
- [x] 3.2 Record a minor release intent for `@indexyz/pi-autocompact`. Verify `npm run change:status` lists it.

## 4. Integration

- [x] 4.1 Run `npm run check` from the repository root and the Pi 0.87.1 RPC load smoke for this package. Verify both exit 0.
- [x] 4.2 Run `openspec validate save-model-limit --strict` from `pi-autocompact/` and `npm run release:gate -- --base origin/main --head HEAD` after the change is committed. Verify both succeed.

## Workflow follow-up

- Archive `save-model-limit` and sync the delta spec into `pi-autocompact/openspec/specs/`.
