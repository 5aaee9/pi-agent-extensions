# Proposal

## Why

Automatic boundary summaries silently drop the session's reasoning effort and the model's output limit. On a reasoning model at thinking level `high`, a native compaction's request carries `reasoning_effort: "high"` and `max_completion_tokens: 4096`; a boundary summary's carries neither. `summarizeBoundary` passes `ctx.modelRegistry.stream` as the summarizer's stream function, but the summarizer sets provider-neutral options. Only `streamSimple` maps `reasoning` to the provider's effort and fills `maxTokens` from the model; `stream` takes API-specific options and ignores both. `ctx.thinkingLevel` therefore has no effect on this path.

## What Changes

- Boundary summaries stream through `ctx.modelRegistry.streamSimple`, the same provider-neutral path native compaction uses, so their requests carry the session's reasoning effort and the model's output limit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autocompact-thresholds`: boundary summary requests use the same model options as a native compaction.

## Impact

`pi-autocompact/compaction.ts`. `@indexyz/pi-autocompact` gets a `patch` release intent. The regression scenario lands in `scripts/e2e/pi/pi-autocompact.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
