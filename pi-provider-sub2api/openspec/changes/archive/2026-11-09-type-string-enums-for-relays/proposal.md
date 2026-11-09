# Proposal

## Why

Kimi's validator rejects a whole request when one tool parameter has an `enum` and no `type`
(issue #28). TypeBox's `Type.Enum` and hand-written MCP schemas both produce that shape, and Pi
forwards it unchanged, so one such tool makes every Kimi request fail.

## What Changes

- Every request to a relay adds `type: "string"` to each enum of only strings that has no type.
- Other enums, schemas that already have a type, and other providers' requests stay unchanged.

The change is not scoped to Kimi. The Codex manifest names a model only by slug (`k3.1-pro`), so
scoping would mean guessing from names, and the added type accepts exactly the values the enum
already did. Enums of other types are left alone because not every provider a relay can route to
accepts them typed, and structural keywords are left alone because inferring a type from them
would narrow what the schema accepts.

## Capabilities

### New Capabilities

- `tool-schema-compatibility`: what a relay request adds to a tool schema.

### Modified Capabilities

None.

## Impact

A new `tool-schema.ts` in `files`, one `before_provider_request` handler, the README, and the
scenario in `scripts/e2e/pi/pi-provider-sub2api-tool-schema.e2e.ts`. Tool definitions change once
for affected tools, which can cost one prompt cache miss after upgrading.
`@indexyz/pi-provider-sub2api` gets a `patch` release intent.
