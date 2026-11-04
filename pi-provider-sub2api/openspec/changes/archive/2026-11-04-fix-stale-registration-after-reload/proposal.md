# Proposal

## Why

Pi's model registry outlives `/reload` and merges a re-registration over the previous one, keeping fields left undefined. The extension leaves `streamSimple` out when no model uses Codex, so after a reload that switches a relay from Codex to another API the previous `streamCodex` stays attached: it holds the previous module graph's relay and sends the rotated-out token, while quota requests use the new one. The extension also never unregisters, so a relay removed from `sub2api.json` stays listed and keeps receiving prompts and a credential the user believes is gone. `/sub2api-refresh` reaches the same merge when an automatically routed relay's last Codex model disappears. None of these produce an error.

## What Changes

- On `session_shutdown`, the extension unregisters every relay it registered. An unregister made during the next load only filters that load's pending registrations and never reaches the registry, so the outgoing generation has to do it.
- A registration without a Codex model unregisters first, so a re-registration within one session replaces the handler.

## Capabilities

### New Capabilities

- `relay-registration`: how a relay's registration follows its configuration across `/reload` and `/sub2api-refresh`.

### Modified Capabilities

None.

## Impact

`pi-provider-sub2api/index.ts`. A relay left out of a configuration that fails to load is now removed at reload, matching a fresh start. `@indexyz/pi-provider-sub2api` gets a `patch` release intent. The regression scenarios land in `scripts/e2e/pi/pi-provider-sub2api-reload.e2e.ts`, under the root change `replace-low-value-pi-tests-with-e2e`.
