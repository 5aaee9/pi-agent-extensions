# codex-instruction-cache Specification

## Purpose

Keep a covered GPT-6.2 Codex default in the cacheable developer prefix while an unfixed Sub2API gateway would otherwise place that default in uncached top-level instructions.

## ADDED Requirements

### Requirement: The option is off until a provider turns it on

A provider entry MAY omit `cacheCodexInstructions`. When the field is omitted or `false`, that provider's requests MUST be sent unchanged. `true` MUST enable the rewrite only for that provider. A value that is present and not a boolean MUST fail configuration loading with an error that names the provider and `cacheCodexInstructions` and MUST NOT include the configured token.

#### Scenario: The field is omitted

- **WHEN** a provider entry has no `cacheCodexInstructions`
- **THEN** a GPT-6.2 Sol Codex Responses request is sent without a top-level `instructions` field and without the pinned default

#### Scenario: The option is enabled on one provider

- **WHEN** provider A sets `cacheCodexInstructions` to `true` and provider B omits it
- **THEN** only provider A's covered request is rewritten

#### Scenario: A non-boolean value

- **WHEN** `cacheCodexInstructions` is a string and the entry has a token
- **THEN** loading fails with an error that names the provider and `cacheCodexInstructions` and does not contain that token

### Requirement: Only covered Codex model IDs are rewritten

The rewrite MUST apply only when the current model uses `openai-codex-responses` and its ID is a covered GPT-6.2 Sol or Astra spelling. A request whose `model` field is not the current model ID MUST be left unchanged. Other APIs and other model IDs MUST be left unchanged.

#### Scenario: Canonical spelling

- **WHEN** the option is on and the model ID is `openai/GPT-6.2-Sol`
- **THEN** the request uses the pinned Sol default

### Requirement: Covered spellings match the gateway aliases

A covered spelling MUST be `gpt-6.2-sol` or `gpt-6.2-astra` after the extension trims the ID, keeps the segment after the last `/`, ignores case, treats `_` and whitespace as `-`, and collapses repeated hyphens. The same base plus one suffix of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `openai-compact` MUST also be covered. Any other suffix MUST NOT be covered.

#### Scenario: An effort alias

- **WHEN** the option is on and the current model ID is `gpt-6.2-sol-high`
- **THEN** the request uses the pinned Sol default

#### Scenario: An older model

- **WHEN** the option is on and the current model ID is `gpt-5.4`
- **THEN** the request is unchanged

#### Scenario: Another API

- **WHEN** the option is on and the current model uses the OpenAI Responses API with ID `gpt-6.2-sol`
- **THEN** the request is unchanged

### Requirement: A blank instructions field keeps the pinned default in input

When the option applies and `instructions` is missing, not a string, or blank after trimming, the extension MUST prepend the pinned default for that model as a `developer` message and MUST set `instructions` to `Apply the developer instructions at the beginning of this input to the current request.` Existing input items MUST keep their order after that message. Other request fields MUST keep their values.

#### Scenario: Pi already sent a developer prompt

- **WHEN** a covered request has a leading developer message and no `instructions` field
- **THEN** the first input item is the pinned default, the original developer message is next, and `instructions` is the short sentence

#### Scenario: The rewrite runs twice

- **WHEN** the rewritten request is rewritten again
- **THEN** the request stays the same

### Requirement: The pinned text is the v0.2.24 template

The pinned Sol and Astra texts MUST be the Sub2API v0.2.24 Codex templates for those models after trimming.

#### Scenario: The templates stay stable

- **WHEN** the pinned Sol and Astra texts are hashed
- **THEN** they match the trimmed templates from Sub2API commit `5c2982a81b46e2142d0143d2f83c1ce9c4da1d24`

### Requirement: Explicit instructions stay explicit

When `instructions` is a non-blank string, the extension MUST keep that string and MUST NOT prepend the pinned default.

#### Scenario: A turn-scoped instruction

- **WHEN** a covered request has `instructions` set to `Focus on this turn.`
- **THEN** `instructions` remains `Focus on this turn.` and the pinned default is not added

### Requirement: System items stay in input

On a covered request, the extension MUST change each `system` item's role to `developer` without changing its content or its position relative to other existing items.

#### Scenario: A system prompt with an explicit instruction

- **WHEN** a covered request has a system message and a non-blank `instructions` string
- **THEN** that message's role is `developer`, its content is unchanged, and `instructions` is unchanged

### Requirement: Native compaction uses the same rewrite

A native Codex compaction request for a covered compaction model MUST be rewritten by the same rules before it is sent. The `compaction_trigger` item MUST remain last.

#### Scenario: Compaction with a system prompt

- **WHEN** the option is on and native compaction runs on `gpt-6.2-sol` with no `instructions` field
- **THEN** the compaction request starts with the pinned Sol default, ends with `compaction_trigger`, and its `instructions` value is the short sentence

### Requirement: Prompt replacements still edit Pi's prompt

Prompt replacements MUST run before this rewrite. A replacement MUST edit the original leading prompt. When this rewrite prepends the pinned default, that edited prompt MUST be the following item.

#### Scenario: A replacement and the cache option

- **WHEN** a matching replacement changes the leading prompt and the cache option also applies
- **THEN** the first input item is the pinned default and the next item contains the replaced prompt
