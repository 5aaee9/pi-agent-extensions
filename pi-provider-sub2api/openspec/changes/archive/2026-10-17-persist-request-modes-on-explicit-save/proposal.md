# Proposal

## Why

Fast, Ultrafast, and Daybreak currently share extension-wide in-memory switches and disappear on reload. Users need independent provider defaults and model preferences, while experimenting without writing configuration until they explicitly save.

## What Changes

- Add provider `requestModes` and provider-local `modelRequestModes` to `sub2api.json`, with field-by-field model-over-provider inheritance.
- Keep `/toggle-fast`, `/toggle-ultrafast`, and `/toggle-daybreak` as memory-only commands; isolate temporary changes by provider and model.
- Add `/sub2api-save` to save the current model preferences and `/sub2api-save provider` to save the current effective preferences as provider defaults. No `/save` alias or Ctrl+S integration.
- Keep Fast and Ultrafast mutually exclusive, and Daybreak independent so either tier can coexist with Daybreak.
- Resolve requests, footer indicators, and the existing compaction tier fallback from the same current-model state. Preserve explicit compaction overrides and do not add Daybreak to native compaction.
- **BREAKING**: mode toggles no longer affect every provider/model; disabling a selected tier explicitly selects the default tier rather than restoring an upstream payload tier.
- Document supported protocol boundaries without claiming unverified model eligibility. In particular, do not illustrate GPT-5.5 with Ultrafast.

## Capabilities

### New Capabilities

- `request-mode-persistence`: scoped temporary request modes, inherited configuration, and explicit save behavior.

### Modified Capabilities

None; the package currently has no durable specs.

## Impact

Implementation touches `config.ts`, `types.ts`, request-mode wiring in `index.ts`, `relay-stream.ts`, the compaction tier callback, and focused tests. A small request-mode module may separate resolution and persistence from wiring. Update the package README and root package-table description during implementation. No host API changes, new dependencies, model capability registry, file watchers, session-history persistence, or generic settings framework. This proposal changes planning artifacts only; the later published implementation needs a release intent and repository verification.
