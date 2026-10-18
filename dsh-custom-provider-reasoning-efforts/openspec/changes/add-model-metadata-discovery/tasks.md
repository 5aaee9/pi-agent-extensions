# Tasks

## 1. Listing metadata parsing

- [x] 1.1 Extend `ListedModel` in `reasoning.ts` with optional `name`, `contextWindow`, and `maxTokens`, and parse them in both `readModelListing` and `readManifestListing` using the Harness probe's spellings (name: `name`/`display_name`/`displayName`; context: `contextWindow`/`context_window`/`context_length`/`max_input_tokens`/`limit.context`/`limits.context`; output: `maxOutputTokens`/`max_output_tokens`/`maxTokens`/`max_tokens`/`limit.output`/`limits.output`/`top_provider.max_completion_tokens`), accepting only positive integers and non-empty strings — verify in `test/reasoning.test.ts`: every spelling, a nested `limit` object, non-positive and fractional values, and a manifest `display_name`/`context_window`
- [x] 1.2 Carry the parsed metadata through `mergeListings` in `runtime.ts` with the listing's value winning per field and the manifest filling only what the listing leaves out — verify in `test/runtime.test.ts`: disagrees (listing wins), listing-silent (manifest fills)

## 2. Gap-only planning

- [x] 2.1 Extend `plan.ts`: `ModelField` gains `name`, `contextWindow`, `maxTokens`; `Intent` gains `mode?: "replace" | "fill"`; a `fill` intent skips silently when the entry already carries the field, and the default `replace` keeps today's compare-and-write behavior — verify in `test/plan.test.ts`: fills an absent field, leaves an authored value untouched, replaces in the default mode
- [x] 2.2 Emit the metadata intents from discovery for declared models only, and render numeric/string changes in the command answers — verify in `test/runtime.test.ts`: a manifest fills a declared model's missing `contextWindow`, a present value is not overwritten, and the answer renders `contextWindow -> 500000`

## 3. Documentation and release decision

- [x] 3.1 Extend the package `README.md` discovery section and behavior notes: the metadata fields read, the gap-only fill contract, the listing-wins merge, the deliberate omission of manifest-only models (with the `models` list as the way to register one), and that `clear` leaves metadata in place — verify by comparing the table and notes with `reasoning.ts`/`plan.ts`
- [x] 3.2 Widen the pending minor release intent's summary in `.changeset/calm-snails-smash.md` to cover metadata discovery rather than adding a second intent file for the same package — verify with `npm run change:status`
- [x] 3.3 Confirm `cordis.patch.yml`, `test/smoke-release.ts`, and the manifest need no change — verify by running the smoke check against a packed build

## 4. Verification

- [x] 4.1 Run `npm run check --workspace @indexyz/dsh-custom-provider-reasoning-efforts` (typecheck, build, Vitest) — all green
- [x] 4.2 Run `npm run check` from the repository root (format, lint including the strict tooling profile, workspace typecheck, builds, tests, release-script tests) — all green
- [x] 4.3 Pack and smoke-check: `npm pack --workspace @indexyz/dsh-custom-provider-reasoning-efforts`, run `test/smoke-release.ts` against the packed install — exits 0

## Workflow follow-up

- Archive `add-model-metadata-discovery` (and the pending `add-vision-declarations`) with `npx openspec archive <name>` after the owner confirms the live result.
- The live check is the owner's restart of `dsh web`: the discovery pass then fills the Zero Codex models' `contextWindow` from the manifest; a later `grep contextWindow ~/.dsh/profiles/web/cordis.patch.yml` shows it.
