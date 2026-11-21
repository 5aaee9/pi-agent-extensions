# Design

## Context

Pi 1.6.0 already omits top-level `instructions` and puts its system prompt in `input`. Sub2API v0.2.24 (`5c2982a81b46e2142d0143d2f83c1ce9c4da1d24`) replaces a missing, non-string, or blank `instructions` field with `defaultCodexSynthInstructions` for ordinary Codex OAuth. For `gpt-6.2-sol` and `gpt-6.2-astra` those templates are 27,768 and 27,326 UTF-8 bytes after trim. GPT-6.2 appends that field after `input` and bills it uncached. Passthrough injects only when the field is absent and the model name contains `codex`. The plugin cannot see the account type or mapped model. [Sub2API #8985](https://github.com/Wei-Shaw/sub2api/pull/8985) is open and not merged.

## Goals / Non-Goals

**Goals:**

- Give one provider a reversible way to stop that long default from occupying top-level `instructions`.
- Preserve the same default text in the leading developer message for the model families whose template is pinned.
- Leave explicit non-blank instructions unchanged.
- Cover normal Codex Responses turns and native compaction, and stay idempotent.

**Non-Goals:**

- Detecting passthrough, API-key, or a future fixed gateway.
- Inventing a prompt for unrecognized GPT-6.2 spellings or older models.
- Changing requests for every model on a provider.

## Decisions

1. Default the option off. Enabling it changes passthrough and API-key requests, which do not receive this default today, and it pins a gateway prompt that a fixed gateway would otherwise keep current.
2. Recognize only `gpt-6.2-sol` and `gpt-6.2-astra`, plus the suffixes `GPT62ModelID` accepts. Other suffixes make v0.2.24 fall through to a different prompt, so they are not rewritten.
3. On a blank `instructions` field, prepend the pinned template as a developer message and set `instructions` to one short sentence that points at that message. The sentence is non-blank, so the unfixed gateway does not refill the field, and it is short, so the uncached remainder is small.
4. Rename `system` items to `developer` on a covered request so the gateway does not copy them into `instructions`. Do this even when instructions are already non-blank. Do not prepend the template in that case, because the gateway would not add its default either.
5. Run after prompt replacements. Replacements still edit Pi's original leading prompt; the pinned default is inserted ahead of it.
6. Apply the same function to the compaction body. Compaction does not pass through `before_provider_request`.

## Risks / Trade-offs

- The short sentence is still uncached on GPT-6.2.
- The pinned text can drift from a newer gateway. Turn the option off after the gateway places its own current default in `input`.
- Account mapping that changes the family is invisible. The request model selects the template.
- Tests replay the v0.2.24 field rule locally. They do not measure live token billing.

## Migration Plan

No migration. Existing configuration keeps the previous requests until `cacheCodexInstructions` is `true`.

## Open Questions

None.
