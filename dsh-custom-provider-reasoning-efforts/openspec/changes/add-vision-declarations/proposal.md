# Proposal

## Why

A hand-written `llm-pi-ai` route that serves a vision model resolves it to text-only: a model entry without an explicit `input` list inherits the route's `defaultInput` (default `["text"]`), and `dsh-llm-pi-ai` refuses every request that carries an image block with `UNSUPPORTED_CONTENT` ("does not support image input"). The `reasoningEfforts` seam this plugin already owns fixes only the reasoning half; the vision half needs a second field on the same model entries, and — like reasoning — the gateway itself usually publishes it on the same `/v1/models` listing the plugin already interrogates.

## What Changes

- **A `vision` declaration table in the row configuration**: keyed by route then model id, each value a modality array — `[text, image]` for a vision model, `[text]` for a model the route must not send images to (including one whose catalog or route default unfairly claims vision). Every entry is validated at load: empty, empty after undefined members are dropped, a member outside the {`text`, `image`} vocabulary, or an array without `text` fails the load naming the route and model. Valued members keep their declaration order.
- **The same plan/write path carries the field**: each model entry's declaration is written to the entry's `input` field through the settings service, exactly as `reasoningEfforts` is — planned against the profile patch's own raw `providers` value, written only when the value differs, and reported as a change with its field named. Explicit vision and explicit reasoning declarations on the same pair coexist: writing one never disturbs the other.
- **Discovery reads the modalities the listing publishes**: the same interrogation that fills reasoning levels also reads each entry's declared request modalities — gathered from `input_modalities`, `supported_input_modalities`, and the `architecture` object's `input_modalities` / `modality` (`text+image` shapes) — and turns a list that names `image` into a vision intent for the models the route declares. Only routes the plugin already probes are consulted; only models the route's explicit `models` list declares are considered; a listing that states no modalities leaves the model untouched and is not an error. Text-only listings produce nothing to write — declarations remain the tool for stripping an inherited vision claim.
- **`/reasoning-efforts`, unchanged in name, now speaks for both tables**: `status` plans the reasoning and the vision intents, `apply` writes both, `clear` removes the `reasoningEfforts` field and the `input` field the tables name, and `discover` runs the probe whose answer feeds both. Every answer names the field a planned change or skip belongs to; an explicit declaration of either table wins over a discovered one.
- **Explicit wins, nothing is invented**: a discovered modality list is only written when it names `image` and the model receives no explicit declaration; a model the listing describes but the route does not declare is skipped; and a discovered list whose members are all outside the vocabulary (audio, video) maps to no value rather than to an invented one.

## Capabilities

### New Capabilities

- `vision-declarations`: the vision declaration grammar and its validation, the planning and writing of a model entry's `input` field through the settings seam, the endpoint listing's modality fields and how they become discovery intents, and `/reasoning-efforts` status/apply/clear/discover behavior over both tables.

### Modified Capabilities

(none — the repository's main specs are empty and the existing capability deltas live in the un-archived `add-custom-provider-reasoning-efforts` change; nothing in this change alters their requirement texts, and `reasoning-efforts-package`'s "the documentation matches the row" requirement continues to hold with the `vision` field added to the row and the README.)

## Impact

- `Config` (index.ts) gains the `vision` field; load-time validation moves from a single table to two.
- `declarations.ts` gains the modality vocabulary, the array grammar, and its validator beside the efforts validator.
- `plan.ts` intents become field-tagged (`reasoningEfforts` | `input`); `apply.ts`, `runtime.ts`, and the answer formatting name the field.
- `reasoning.ts` / `discovery.ts` gain the modality read of an already-parsed listing entry; `runtime.ts` merges discovery's vision intents like its reasoning intents, and `clear` extends to the `input` field.
- Tests: `test/vision.test.ts` (new), plus extensions to the runtime, plan, apply, and index suites; `README.md` and the root README row updated.
- Release: the change alters the package's published content, so it carries a minor intent for `@indexyz/dsh-custom-provider-reasoning-efforts` per `docs/releases.md`.
- The release smoke check (`test/smoke-release.ts`) needs no change: the manifest, files allowlist, and bundle patch are untouched.
