# Design

## Context

See `proposal.md` for why. Relay entries are the top-level keys of `sub2api.json`. `parseRelayConfig` validates each entry. `before_provider_request` handlers already chain: a returned payload becomes the next handler's `event.payload`, and `undefined` keeps the current one (`pi-coding-agent` 1.5.0). Pi's `openai-codex-responses` adapter places the system prompt in the top-level `instructions` string. `openai-responses` puts it in `input`, Chat Completions in `messages`, and Anthropic in `system`. Native Codex compaction posts its own body and does not use this hook.

## Goals / Non-Goals

**Goals:**

- Opt-in, per-provider rules with the shape from issue #29.
- Literal, ordered replacement of `instructions` only, with the rest of the payload left intact.
- The same failure style as the other settings: load rejects a bad value and names the provider and field, without echoing the token.

**Non-Goals:**

- Rewriting `system`, `messages`, or `input`. Those adapters do not use `instructions`.
- Rewriting the native compaction request.
- A new dependency, a default rule, or a change to requests that omit the field.

## Decisions

### 1. The rule lives on the provider entry

`promptReplacements` is a field of the existing provider object. In the issue's example, `sub2api` is that provider's name, the same way `my-relay` is today. There is no new wrapper and no top-level key.

A rule is `{ models, from, to }`. Extra keys are ignored, as they are on `requestModes`. `to` may be `""` so a phrase can be deleted. `from` must be a non-empty string. `models` must be a non-empty array. Each pattern uses the existing model-ID limits (1–256 characters, no surrounding whitespace, no control characters) so a pattern cannot be a value discovery would already reject as an ID, aside from `*`.

### 2. `*` is the only wildcard, and it matches the whole ID

`gemini-*` matches `gemini-2.5-pro` and not `gemini` or `my-gemini-2.5-pro`. `*` matches every ID of that provider. `.`, `+`, `?`, and other regex characters match themselves. Comparison is case-sensitive. A rule matches when any pattern matches.

The matcher escapes every character and turns `*` into a `.*` span, anchored at both ends. A glob library would add a dependency for one metacharacter. Unanchored search would let `gemini-*` match a suffix of another ID.

### 3. Apply on the chained payload, and only to a string `instructions`

A new handler runs after the server-tool, tool-schema, and request-mode handlers. It reads `event.payload`, which already includes those edits. It looks up `relaysByProvider` by the current model's provider, so another provider's rules cannot apply. It also requires `payload.model === current model id`, the same guard the other payload edits use, so a body built for a different model is left alone.

Replacement uses split/join, so `from` is literal and a `to` that contains `from` is not fed back into the same rule. Rules run in array order; each sees the string the previous rule produced. Every occurrence is replaced, so a repeated sentence does not leave a copy behind. When `instructions` is missing or not a string, the handler returns without changing the payload and without throwing.

When no rule changes the string, the handler returns `undefined` so the payload object stays the one it received. When it does change, the handler returns a shallow copy with only `instructions` replaced. The original payload is not mutated.

### 4. Invalid configuration fails at load

`promptReplacements` that is not an array, a non-object rule, a missing or empty `models`, a bad pattern, a missing or empty `from`, or a non-string `to` throws from `parseRelayConfig`. The message names the provider and the field. It does not include the token. An omitted field and `[]` both store no rules.

### 5. Release

This is new, backwards-compatible behavior, so the intent is `minor`, the same kind of bump as per-model request modes. A patch would fit a correction of existing behavior. Nothing is published by this change.

## Risks / Trade-offs

- [A short `from` also occurs later in the prompt] → Every occurrence is replaced, and the README says so. Users choose the phrase.
- [Other APIs never set `instructions`] → The README names `openai-codex-responses` as the adapter that does, and states that the other adapters are unchanged.
- [The new wording misses a prompt cache once] → Expected for any prompt edit. Omitting the field avoids it.
- [Native compaction can still send the original sentence] → Out of scope. The README says that request is separate.

## Migration Plan

Add `promptReplacements` to the provider entry and `/reload`. Remove the field to restore the previous request. No file migration.

## Open Questions

None.
