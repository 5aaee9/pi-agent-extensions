# Tasks

## 1. Declaration model for modalities

- [x] 1.1 Extend `declarations.ts` beside the efforts grammar: the `ModelInput` type (a readonly array over the `"text"`/`"image"` vocabulary), `MODALITIES` in vocabulary order, `validateModelInput(route, model, raw)` accepting a non-empty array containing `text` with every member in the vocabulary (declaration order kept, duplicate members kept as written) and rejecting empty, unknown-member-only, and `[image]`-without-`text` arrays with messages naming the route, the model, and the offending member, plus `describeInput(value)` rendering `text/image` — verify with new cases in `test/declarations.test.ts` covering every acceptance and rejection message
- [x] 1.2 Extend `validateDeclarations` (or its sibling) to validate a `vision` table with the same load-failure contract and the same empty-route/empty-model diagnostics — verify in `test/declarations.test.ts`

## 2. Field-tagged planning and the settings write

- [x] 2.1 In `plan.ts`, tag `Intent`/`Change`/`Skip` with `field: "reasoningEfforts" | "input"`, resolve the tagged field in `planProviders` with the existing `hasOwn`/`isDeepStrictEqual` logic (both fields writable on one entry, removal deletes only the tagged field), and default absent tags at construction so existing reasoning callers keep their call sites unchanged — verify in `test/plan.test.ts`: same-pair two-field intents land in one planned entry, each field compares and removes independently, skips carry their field
- [x] 2.2 Confirm `apply.ts` needs no behavioral change beyond transparent types (the seam writes the whole planned `providers` value); add one test in `test/apply.test.ts` that a write whose plan changed both `reasoningEfforts` and `input` on the same entry issues a single `update()` carrying both — verify the conflicting-retry path is unaffected

## 3. Discovery reads modalities

- [x] 3.1 In `reasoning.ts`, add `modalitiesOf(entry)` reading `input_modalities`, `supported_input_modalities`, and `architecture.input_modalities` / `architecture.modality` (splitting a `text+image`-style joined value on `/`, `+`, `,`, and whitespace; mapping tokens case-insensitively, `input-text`/`input-image` included, dropping everything outside `text`/`image`), add the optional `inputModalities` member to `ListedModel`, and fill it in `readModelListing` and `readManifestListing` entries — verify in `test/reasoning.test.ts`: every field spelling, the joined spelling, case-insensitivity, unknown-member dropping, text-only and silent entries
- [x] 3.2 In `runtime.ts`'s discovery merge, emit a vision intent (field `input`) for a listed model whose modalities include `image` and whose id the route's explicit `models` list declares, merging under the same explicit-wins rule as the reasoning intents and producing no intent for a text-only or silent listing — verify in `test/runtime.test.ts`: the discovered vision intent lands, an explicit `vision` declaration wins, a text-only listing writes nothing, and the Codex manifest path still carries no modality read

## 4. Command surface and row config

- [x] 4.1 In `index.ts`, add `vision` to `Config` (`z.dict(z.dict(modalityArray))`, default `{}`), pass the validated table into `createRuntime`, and include removal intents from the `vision` table in `clear` — verify in `test/index.test.ts`: a malformed `vision` table fails `apply` at load, `clear` removes the `input` field of the pairs it names, and an empty `vision` table changes nothing
- [x] 4.2 Extend `runtime.ts`'s answer formatting so every change and skip names its field (`reasoningEfforts`/`input`), `describeInput` renders vision changes, and the counts/already-current accounting spans both tables — verify in `test/runtime.test.ts`: an answer carrying both fields' changes and a vision skip reads correctly, and a both-tables no-change answer reports that state

## 5. Documentation and release decision

- [x] 5.1 Update the package `README.md`: the declarations section gains the `vision` table with its grammar and the `text`-required caveat, the discovery section gains the modality fields read (`input_modalities`, `supported_input_modalities`, `architecture`), the configuration table gains `vision`, and the command section documents that one pass covers both fields — verify by comparing the table with `Config`
- [x] 5.2 Update the root `README.md` row description and record a minor release intent: `npm run change -- --minor @indexyz/dsh-custom-provider-reasoning-efforts -m "Declare vision modalities for hand-written provider routes"` — verify `npm run change:status` lists the intent
- [x] 5.3 Confirm `cordis.patch.yml`, `test/smoke-release.ts`, and the manifest need no change (the bundle patch and files allowlist are untouched) — verify by running the existing smoke check against a build

## 6. Verification

- [x] 6.1 Run `npm run check --workspace @indexyz/dsh-custom-provider-reasoning-efforts` (typecheck, build, all Vitest suites including the new ones) — all green
- [x] 6.2 Run `npm run check` from the repository root (format, lint including the strict tooling profile, workspace typecheck, builds, tests, release-script tests) — all green
- [x] 6.3 Pack and smoke-check: `npm pack --workspace @indexyz/dsh-custom-provider-reasoning-efforts`, run `test/smoke-release.ts` against the packed install — exits 0

## Workflow follow-up

- Archive the change with `npx openspec archive add-vision-declarations` in this directory once the tasks above are done (after the owner confirms the live verification, as with the package's first change).
- The live profile check (`dsh plugin --profile web add ...` followed by a `dsh web` restart and the model-selection menu) belongs to the owner's environment; note the outcome in the task list rather than automating it here.
