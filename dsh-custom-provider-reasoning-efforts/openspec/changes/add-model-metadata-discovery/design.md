# Design

## Context

Discovery already turns a probe into capability intents (`reasoning.ts` parses, `runtime.ts` merges listing and manifest, `plan.ts` writes field-tagged intents through the settings seam). A bare inventory such as Zero Codex's publishes neither capabilities nor limits in `/v1/models`; its Codex manifest answers both. See proposal.md for motivation; the capability contracts live in `vision-declarations` and `reasoning-efforts-declarations`.

## Goals / Non-Goals

**Goals:**

- One probe fills the metadata a bare inventory omits, on entries the profile already declares.
- No authored value is ever overwritten; the plugin fills gaps only.
- No new model entries and no participation in `clear`.

**Non-Goals:**

- Registering manifest-only models (the `pi-provider-sub2api` sole-inventory behavior). The plugin's contract forbids inventing model entries; a deployment adds them to its `models` list if it wants them served.
- Discovering prices, `compat`, `api`, `baseURL`, or route-level `displayName`.

## Decisions

1. **`fill` is a plan mode, not a separate plan path.** `Intent` gains `mode?: "replace" | "fill"`; the existing field-tagged loop gains one `Object.hasOwn(entry, field)` guard before the equality check. Alternatives were a second planner for metadata (duplicating the route/model resolution and skip reasons) or filtering in the runtime (which would need the entry's current values, a read the plan already performs).
2. **Discovery emits every metadata intent and lets the plan decide.** The runtime does not inspect the profile entry to decide whether to mention `contextWindow`; the plan drops a `fill` intent whose field is present without reporting a change or a skip. This keeps the "already current" accounting honest and keeps the probe code free of configuration reads.
3. **Listing wins over manifest, field by field.** `mergeListings` already merged efforts with the listing's spellings winning; the metadata fields follow the same rule (`existing.field ?? model.field`, where `existing` is the listing). The manifest is a fallback source, not an authority that overrides what the endpoint's own inventory said.
4. **Metadata has no declaration table.** The row configuration's tables describe _capabilities_ a deployment knows about the gateway; metadata is what the gateway publishes about itself, so a declaration for it would be a second way to write the same model fields with different precedence rules. The plugin writes metadata only through discovery, and `clear` therefore leaves it in place.
5. **Spellings are copied from the Harness probe, not invented.** `discoverModels` in `dsh-llm-pi-ai` reads exactly the `contextWindow`/`max_output_tokens` candidate sets this change parses; reusing them means a route the Models page can describe is described the same way here, and the plugin stays a drop-in improvement rather than a parallel vocabulary.

## Risks / Trade-offs

- [A gateway's metadata claim is stale or wrong] → It is written once and then treated as authored by later fills: a later probe will not correct it. The deployment can delete the field to let the next pass fill it again. This is the deliberate cost of "never overwrite".
- [Clearing leaves discovered metadata behind] → Accepted: the fields are indistinguishable from authored ones, and removing them would delete configuration the plugin did not own. The README says so.
- [Manifest-only models stay invisible] → Accepted non-goal; documented, with the `models` list as the sanctioned way to register one.
- [Metadata fill and a capability declaration address the same entry in one pass] → Both land in one `update()`; fields are independent.

## Migration Plan

Additive and idempotent: an existing profile without the fields gains them on the next discovery pass; a profile that already carries them sees no change and no write. Rollback is deleting the fields or removing the plugin; no persisted state belongs to the plugin.

## Open Questions

(none)
