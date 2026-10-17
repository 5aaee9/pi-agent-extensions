# Design

## Context

See proposal.md for motivation. In the current code, index.ts owns one serviceTier and one cyberProgram for all relays. config.ts loads sub2api.json into resolved RelayConfig objects, including resolved secrets; there is no write path. relay-stream.ts already composes tier and Daybreak injection independently. Native compaction obtains its fallback tier through a callback currently reading that global variable.

This change spans configuration, command state, request mutation, and compaction integration, so the following small design makes their semantics explicit.

## Goals / Non-Goals

**Goals:** one field-wise resolver, one explicit persistence command, no implicit disk writes; preserve credential expressions and unrelated configuration.

**Non-Goals:** new command aliases such as /fast or /save; Ctrl+S hooks; persisting /toggle-ultra reasoning; model eligibility discovery or hardcoded capability tables; a generic configuration service; file watching; cross-process locking; dirty-state UI; reset commands; session-branch persistence. Users can remove a saved field in the JSON and reload to restore inheritance.

## Decisions

### 1. Two independent fields with provider-local model overrides

Add optional requestModes and modelRequestModes to each provider. Both mode objects have serviceTier (default/fast/ultrafast) and daybreak (standard/blue). Missing fields inherit; null is invalid. Validate model override keys with the existing isSafeModelId helper, matching discovery rather than adding another validator. No new top-level global defaults or wildcard syntax. This avoids three booleans that could enable conflicting tiers.

A tier-off toggle writes an in-memory default value, not absence, so it can override an inherited Fast setting. Default maps to the explicit wire value default. Daybreak standard likewise explicitly disables automatic Blue selection. An unspecified field remains untouched on the wire. This intentional tier-off behavior change is documented rather than hidden behind a compatibility path.

No real-model configuration example is needed in this proposal. Tests use explicitly synthetic OpenAI-shaped model IDs for protocol behavior and make no eligibility claim. Any real-model examples added during implementation must be checked against authoritative current documentation; GPT-5.5 must not be paired with Ultrafast.

### 2. Small in-memory per-model overlay

Use a provider-keyed map of model-keyed partial preferences, not a concatenated key that could collide. Resolve temporary fields over saved model fields over provider defaults. Existing toggle command names stay unchanged. Reject foreign models or modes unsupported by the existing API/model-ID guards before mutation; do not attempt to verify account entitlements locally.

Requests and footer use the same resolver and applicability guards. Model selection redraws resolved indicators without persisting anything. Reload discards overlays. No session-manager entries or restoration mechanism are necessary.

### 3. One save command, two targets

/sub2api-save saves the current effective defined fields into modelRequestModes[currentModelId]. /sub2api-save provider saves them into requestModes. Replace the target modes object, not the full provider. An empty snapshot is an empty object, not invented off values. Saving inherited defined fields intentionally pins those fields in the chosen scope; later changes to provider defaults do not override an explicitly saved model snapshot.

Both commands use the selected model and scope captured at invocation. Invalid arguments, no model, foreign provider, or unsupported OpenAI mode path are rejected. A model supporting only Fast (Chat Completions) is a valid save target; inactive inherited Responses-only preferences may remain stored, but are never injected or shown as active there.

After success, update the in-memory saved target and redraw; retaining the existing temporary overlay is harmless and prevents an asynchronous save from discarding subsequent toggles. Provider saves do not delete model overrides, including the current model's, and do not clear other temporary overlays. Explain that model-specific overrides still take precedence. Failure leaves all runtime state usable and reports no success.

### 4. Minimal safe JSON update

Use the existing configured path, resolved through symlinks so a linked file is replaced at its target rather than the link being turned into a regular file. Serialize saves within the extension using a promise chain. For each save, reread the raw JSON, validate its object structure and target provider, modify only the requested modes object, then write a unique same-directory temporary file and rename over the destination. Saving re-serializes JSON with consistent indentation; original whitespace is not preserved. Clean up the temporary file on failure; preserve restrictive file permissions. Do not call credential resolution or serialize RelayConfig to save: raw token expressions and other unknown provider settings must remain intact. Fail if the file/provider has disappeared or JSON is malformed rather than creating a replacement provider from stale data.

Fresh reads preserve completed external edits. Atomic replacement prevents truncated JSON. Simultaneous writes from different processes are explicitly last-writer-wins; no locking daemon, retry protocol, or generic transaction abstraction is introduced. This is a limitation, not a guarantee of multi-process conflict-free merging.

### 5. Preserve compaction boundaries

Change the native compaction tier callback to resolve the conversation model supplied by the compaction context, not a global variable or the override compress_model. Preserve command tier > compress_service_tier > resolved conversation tier precedence. An explicit resolved default sends default; absence omits the tier. Keep Daybreak out of native compaction. Do not modify compress_model, one-off command behavior, or reasoning mappings.

## Risks / Trade-offs

- Upstream capability varies by model and account → retain existing protocol guards, surface upstream errors, and avoid unsupported capability examples instead of building a registry.
- Config contains secrets → patch raw JSON only, avoid logging content, and preserve restrictive permissions during replacement.
- Concurrent Pi processes can overwrite an overlapping save → document last-writer-wins; serialize locally and reread before each save, without claiming cross-process locking.
- Provider defaults do not override existing model entries → command feedback names the saved scope and documentation explains precedence.
- Explicit default differs from the previous tier-off passthrough → cover it with request tests and release notes.

## Migration Plan

No migration or compatibility layer: old configurations without the new fields keep startup passthrough behavior. During implementation add fields, resolver, writer, wiring, and tests; update docs and record a release intent. No versions are edited here. Rolling back code leaves optional preferences in JSON but the older parser ignores them. This planning-only change does not alter published files.
