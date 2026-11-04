# Proposal

## Why

The `context` hook does two things before every model call: it removes `/continue`'s hidden marker, and it removes the failed assistant turn before the marker. Compared on the wire on Pi 1.5.0 across `openai-completions`, `openai-responses`, `anthropic-messages`, and `ollama-chat`, with the failed turn carrying partial content, removing the second step changes nothing: Pi's own message transform already drops errored and aborted assistant messages.

The first step is needed. Pi converts the empty marker to an empty user message, which `ollama-chat` then sends.

## What Changes

- The hook only removes the marker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continue-command`: the hidden retry marker never reaches a provider.

## Impact

`pi-continue/index.ts`. `@indexyz/pi-continue` gets a `patch` release intent. The scenario lands in `scripts/e2e/pi/pi-continue.e2e.ts`.
