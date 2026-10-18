# Proposal

## Why

The plugin's discovery already fills a hand-written route's reasoning levels and vision support, but a bare gateway inventory also omits the model facts the Harness needs to size a turn: `context_window` and the display name. Zero Codex — a relay whose `/v1/models` publishes only `id`, `display_name`, and `owned_by` — answers all of it on its Codex manifest (`context_window`, `display_name`, `input_modalities`, `supported_reasoning_levels`), yet dsh keeps resolving those models to the route's defaults (262144 context), so compaction and the model selector are wrong until the deployment hand-writes the numbers. `pi-provider-sub2api` fills exactly these values from the same manifest.

## What Changes

- **Discovery reads the metadata a listing entry publishes**: the display name, `contextWindow`, and `maxTokens` spellings the Harness probe already reads (`context_window`, `context_length`, `max_input_tokens`, `limit.context`, `max_output_tokens`, `limit.output`, `top_provider.max_completion_tokens`, `display_name`, …), from both the listing and the Codex manifest.
- **The fill is gap-only**: metadata intents use a `fill` mode that writes a field only when the profile does not carry it. An authored value — the deployment's own choice — is never overwritten, so the plugin is not a config refresher; it fills what a bare inventory left unset.
- **No model entries are invented**: only models the route's explicit `models` list already declares are filled. The manifest models the profile does not declare (Zero Codex's `gpt-reserve`, `gpt-5.6-*`) stay unregistered, exactly as the capability discovery behaves.
- **`/reasoning-efforts clear` is unchanged**: it removes the `reasoningEfforts` and `input` fields the declaration tables name and leaves discovered metadata in place, because a fill cannot tell the plugin's write from an authored value.
- **The command answers name the field**: a discovered metadata change renders as `route/model contextWindow -> 500000` beside the capability changes, and `status` without discovery plans no metadata (metadata has no declaration table).

## Capabilities

### New Capabilities

- `model-metadata-discovery`: the metadata fields discovery reads, the gap-only fill contract, its sources (listing then Codex manifest), and its separation from declarations and `clear`.

### Modified Capabilities

(none — the capability declarations' requirement texts are untouched; the package capability's documentation requirement continues to hold as the README gains the metadata section.)

## Impact

- `reasoning.ts`: `ListedModel` gains `name`/`contextWindow`/`maxTokens`; the listing readers fill them with the Harness probe's spellings.
- `plan.ts`: `ModelField` gains the metadata fields and `Intent` a `mode: "replace" | "fill"`; the plan writes `fill` intents only into absent fields.
- `runtime.ts`: discovery emits the metadata intents for declared models, the listing/manifest merge carries the fields (listing wins), and answers render them.
- `index.ts` and `cordis.patch.yml`: unchanged; metadata has no row configuration.
- Tests: `test/reasoning.test.ts` (spellings), `test/plan.test.ts` (fill vs replace), `test/runtime.test.ts` (manifest fill, no overwrite, answer rendering).
- Release: the package's published content changes again in the same release window, so the existing minor intent's summary is widened rather than a second intent file added.
- The release smoke check needs no change: manifest, files allowlist, and bundle patch are untouched.

## Non-Goals

- Registering manifest-only models (the `openai-codex-responses`-style sole-inventory behavior `pi-provider-sub2api` implements) — that would break the plugin's "never invent a model entry" contract and is not requested here.
- Writing prices, `compat`, or any other catalog field.
