# Proposal

## Why

With `behaviour.autoSubmitWhenAnsweredWithoutNotes` on, answering a question with a digit leaves the form on the review tab and the model waits, while answering with Enter submits. The number shortcut updates the state without asking the flow to finish.

## What Changes

- The number shortcut finishes the flow when its state is complete, as confirming does.

## Capabilities

### New Capabilities

- `ask-auto-submit`: when an answered ask flow submits itself.

### Modified Capabilities

None.

## Impact

`pi-ask/src/ui/controller.ts`. `@indexyz/pi-ask` gets a `patch` release intent. The regression scenario lands in `scripts/e2e/pi/pi-ask.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
