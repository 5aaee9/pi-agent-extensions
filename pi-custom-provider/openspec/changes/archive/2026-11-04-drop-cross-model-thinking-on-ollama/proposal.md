# Proposal

## Why

After a model switch on an Ollama provider, the thinking of the previous model reaches the new model as visible assistant text: the request carries `content: "<thinking>\n<answer>"`, so the new model reads private reasoning as something it said. The package vendors `transformMessages` because Pi's extension view does not export it, and the copy still converts cross-model thinking to text, although pinned pi-ai 1.5.0 drops it. Nothing compared the copy with the host, so the drift stayed invisible.

Running the same fixtures through the copy and the host exposed two more divergences in the vendored file. The estimator uses 4 characters per token where the host uses 3.5, which changes the `num_predict` an Ollama request carries. `buildBaseOptions` spreads every caller option and always builds `samplingParams`, where the host forwards an explicit list and leaves it unset when nothing supplies it.

## What Changes

- Align `pi-ai-internal.ts` with pinned pi-ai 1.5.0: cross-model thinking is dropped, the estimator uses the host's ratio, and `buildBaseOptions` returns the host's option list. `ollama.ts` reads nothing the host's list omits.
- Add `test/vendored-drift.test.ts`, which runs the same fixtures through the vendored functions and the pinned host's `@earendil-works/pi-ai/api/*` and `utils/*`, names the fixture on any difference, and fails when the resolved `pi-ai` version differs from the package's pin.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ollama-transcripts`: adds what crosses a model change.

## Impact

`pi-custom-provider/pi-ai-internal.ts`, `pi-custom-provider/test/vendored-drift.test.ts`, `pi-custom-provider/README.md`. `@indexyz/pi-custom-provider` gets a `patch` release intent. The regression scenario lands in `scripts/e2e/pi/pi-custom-provider-ollama.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
