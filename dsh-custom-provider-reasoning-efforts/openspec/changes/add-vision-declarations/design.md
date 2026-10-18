# Design

## Context

The plugin already owns one seam: the `llm-pi-ai` row's `volatile` `providers` field, written through `settings.describe()` / `update()` (`apply.ts` → `plan.ts` → `runtime.ts`), with endpoint discovery reading the same `/v1/models` reply the Harness probe drops reasoning from (`discovery.ts` → `reasoning.ts`). Vision is the second capability field on the same model entries: `dsh-llm-pi-ai` resolves `input` as `declaredInput(entry.input) ?? base?.input ?? defaultInput` and gates images on `model.input.includes("image")` (`UNSUPPORTED_CONTENT` otherwise). The host's own `discoverModels` never parses modality fields from a network listing (`LlmDiscoveredModel.inputModalities` is filled only from the catalog path), so the vocabulary and spellings below are read from OpenRouter's published convention — the field gateways actually emit — and validated to the vocabulary `dsh-llm-pi-ai` itself accepts (`ModelModalityMap`: `text`, `image`).

## Goals / Non-Goals

**Goals:**

- One write pass plans and writes both fields; both tables ride the existing seam unchanged.
- Discovery reuses the probe the plugin already makes — no second request for modality reading.
- The command surface stays `/reasoning-efforts` with the same four modes; answers name the field.

**Non-Goals:**

- Codex manifest modality reading (the manifest's shape carries efforts only; extending `readManifestListing` is left to a later need).
- Writing `modelOverrides` or any route the profile does not already declare.
- A dedicated `/vision` command; the row's namespace config is shared either way and one command avoids two verbs for one seam.

## Decisions

1. **Row field `vision` with a modality-array grammar (`[text, image]`, `[text]`) rather than booleans.** The arrays are exactly what `llm-pi-ai` accepts on a `models` entry, so what a user writes is what lands in the profile — no translation table to document, and text-only stripping reads naturally. A boolean grammar (`true` → `[text, image]`, `false` → `[text]`) was considered and rejected as a thinner spelling that would still need the same validation plus a mapping to explain. One caveat is documented instead of hidden: an empty array is rejected, because `declaredInput([])` returns "no answer" and would let the entry fall through to the catalog — the one spelling that cannot express a true claim.
2. **`text` is required in every declaration.** `ModelModalityMap` has no single-modality semantic that makes `["image"]` alone a sensible claim, and a resolved model whose `input` lacks `text` refuses every ordinary request. The validator requires it with a message naming `text`, rather than silently appending it — appending would make the written value differ from the declaration the user wrote.
3. **Intents become field-tagged; the plan stays value-based.** `Intent`/`Change`/`Skip` gain a `field` discriminant (`reasoningEfforts` | `input`); `planProviders` resolves the intent's field on the entry with the same `hasOwn` / `isDeepStrictEqual` logic it uses today, and the field tag rides the reported change and skip. Two intents on the same pair merge into one planned entry simply because both mutate the same cloned entry — no cross-intent ordering rules are needed. Alternative rejected: separate planner functions would duplicate the skip reasons and the already-current accounting.
4. **Discovery reads modalities from the already-parsed listing entry, not a second request.** `reasoning.ts` gains `modalitiesOf(entry)` beside `effortsOf(entry)`, reading `input_modalities`, `supported_input_modalities`, the `architecture` object's `input_modalities` / `modality`, and the nested `modalities.input` / top-level `modalities` arrays the observed gateway publishes (the `text+image` joined shape is split on `/`, `+`, `,`, or whitespace), mapping tokens case-insensitively (also `input-text`/`input-image`) onto the two-modality vocabulary and dropping the rest. `ListedModel` gains an `inputModalities` member; `runtime.ts` emits a vision intent from it only when the list includes `image` and the route declares the model, and merges discovery's vision intents under the same explicit-wins rule the reasoning intents follow. A text-only discovered list produces no intent — stripping is a user's decision, not an endpoint's.
5. **`clear` removes the `input` field from the `vision` table's pairs and keeps the reasoning table's removal unchanged.** The two removal intents are independent field-tagged intents, so a pair named by both tables loses both fields in one pass; a pair named only by one loses exactly that field.
6. **Schema text, not identifiers, reuses the existing grammar.** `vision`'s schema is `z.dict(z.dict(modalityArray))` where `modalityArray` is a non-empty array over `z.union([z.const("text"), z.const("image")])`; the semantic rules (at least `text`, no non-vocabulary survivors, empty rejected) live in the same load-time validator the efforts use (`declarations.ts`), so a malformed table fails the load before any pass runs.

## Risks / Trade-offs

- [A gateway publishes modality spellings this module does not read] → The unknown-member rule means a misunderstood spelling is indistinguishable from silence: the model is left untouched and nothing is written. Users can declare explicitly; the README lists the fields read.
- [`input_modalities: ["video"]`-style lists are dropped entirely] → accepted: the vocabulary has no video member, and writing a guessed `["text"]` from it would contradict the endpoint's own answer.
- [Reasoning and vision changes to the same pair in one pass] → both land in one `update()`; if the Loader rejected the combined value, both changes fail together in the report. Acceptable: they are independent fields with no semantic coupling.
- [Command name still says "reasoning-efforts" while it now also writes modalities] → kept: renaming the command or the package breaks the published surface for no functional gain; README and the command description say both tables are covered.

## Migration Plan

Additive: existing rows with only `providers` keep working; `vision` defaults to an empty table that plans no intents. The discovered-vision path only produces intents for listings that advertise the fields this build reads, so a deployment that discovers reasoning today sees no behavior change until its gateway publishes modalities. Rollback is `/reasoning-efforts clear` for the declared pairs or plugin removal (the written fields persist in the profile patch, as the reasoning fields do).

## Open Questions

(none)
