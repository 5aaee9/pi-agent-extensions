# Proposal

## Why

`/answer` fails for anyone without Anthropic credentials on the default configuration: it reports `Provider is not configured: anthropic` and never falls back to the chat model. `selectExtractionModel` treats `modelRegistry.getApiKeyAndHeaders(model).ok` as "this model has credentials", but Pi answers `ok: true` for a provider with no credentials unless it requires an auth header. The request then throws in `modelRegistry.complete`. The same misreading hides a chat model that has no credentials behind the raw error instead of the message the command already has for it.

The settings overlay and `docs/configuration.md` also still name the upstream package, `@eko24ive/pi-ask`, instead of this one.

## What Changes

- A model counts as usable for extraction only when `modelRegistry.hasConfiguredAuth` confirms credentials and `getApiKeyAndHeaders` still resolves them. This applies to the configured `answer.extractionModels` and to the chat model fallback.
- The `/ask-settings` header and `docs/configuration.md` name `@indexyz/pi-ask`. The `@eko24ive/pi-ask:*` event channels, which are shared with upstream, and the attribution in `README.md` and `LICENSE` stay.

## Capabilities

### New Capabilities

- `answer-extraction`: how `/answer` selects the model that extracts questions.

### Modified Capabilities

None.

## Impact

`pi-ask/src/answer-extraction.ts`, `pi-ask/src/ui/settings-list.ts`, and `pi-ask/docs/configuration.md`. `@indexyz/pi-ask` gets a `patch` release intent. The regression scenarios land in `scripts/e2e/pi/pi-ask-answer.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
