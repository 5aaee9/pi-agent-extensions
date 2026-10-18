# Tasks

## 1. Host resolution

- [x] 1.1 Extend `resolveLimit` in `settings.ts` with the optional deployment default and a `defaultLimit` load-time validator; verify with the new unit cases in `test/settings.test.ts` covering per-model-over-default, session-over-default, explicit `off`, unset, and malformed values
- [x] 1.2 Add `defaultLimit: z.natural().volatile()` to `Config` in `index.ts`, read it through `liveValue` in `apply`, and pass it to `resolveLimit` in both `checkPressure` and the command handler; verify with `test/index.test.ts` cases that a default compacts an uncovered route, that `off` masks it, that a live volatile write is seen, and that an invalid default fails the load
- [x] 1.3 Label the command's threshold source (`session`, `global default`, `deployment default`) and keep the existing report wording; verify the command tests assert the label

## 2. Settings editor

- [x] 2.1 Carry `defaultLimit` through the client contracts, `config-store.ts` (`AutocompactConfig.defaultLimit`), and `state.ts` (`ViewState.defaultLimit` plus `defaultChanged`); verify with `test/client.test.ts` store and state assertions
- [x] 2.2 Render the **Default threshold** editor above the per-model card in `page.tsx` (input in the `300k`/`1m` grammar, blank means unset, disabled when read-only or busy) and emit `set`/`unset ["defaultLimit"]` in the existing `mutate` save; add the English and Chinese strings to `dictionary.ts`; verify with `test/client.test.ts` cases for setting, clearing, rejecting `banana`, and read-only rendering
- [x] 2.3 Keep the save visible to the status pill through the shared store; verify the existing "follows a save" test still passes and add a default-threshold save case

## 3. Composer status line

- [x] 3.1 Resolve the pill's threshold as `limits[route] ?? defaultLimit`, keeping the master-switch-off branch and the no-seat branch as they are; verify with `test/client.test.ts` cases for a default-only route, a per-model override winning, no default and no per-model entry, and the switch off

## 4. Documentation and release record

- [x] 4.1 Update `README.md`: the Settings page description, the composer status table, the optional-defaults table and YAML example, and the behavior/limitations notes; verify every documented field and precedence statement matches the code and the specs
- [x] 4.2 Record the release decision for `@indexyz/dsh-autocompact` (the intent summary becomes the CHANGELOG entry; no hand-edited version section); verify `npm run change:status` lists it

## 5. Verification

- [x] 5.1 Run `npm run check --workspace @indexyz/dsh-autocompact` (typecheck, build both halves, tests) and `npm run check` from the repository root; record the exact results
- [x] 5.2 Build both halves and run `node dsh-autocompact/test/smoke-release.ts dsh-autocompact`; verify it exits 0 with the intact-artifact line

## Workflow follow-up

- Run `npm run release:gate -- --base origin/main --head HEAD` once the change is committed on a branch; the local gate compares commits and cannot see an uncommitted tree.
- Archive this change after the unarchived `add-dsh-autocompact` baseline lands: archiving the default-threshold deltas alone would leave the package's main specs describing only the new requirements. Until then the full behavior stays in the two change deltas.
