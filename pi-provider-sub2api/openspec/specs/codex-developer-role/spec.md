# codex-developer-role Specification

## Purpose

Keep Pi's Codex prompt in `input` as a developer message, matching the official Codex client, without writing top-level `instructions` or copying a gateway prompt.

## Requirements

### Requirement: Codex Responses requests keep system text in input

On every `openai-codex-responses` model, the extension MUST change every `system` item's role to `developer` before the request is sent. The item's content and its position relative to other existing items MUST stay the same. A request that contains no `system` item MUST be left unchanged. Applying the rename twice MUST NOT change the request again.

#### Scenario: GPT-6.2

- **WHEN** a `gpt-6.2-sol` Codex request starts with a system message and has no `instructions` field
- **THEN** that message's role is `developer`, its content is unchanged, and the request still has no `instructions` field

#### Scenario: GPT-6.1 and older Codex models

- **WHEN** the Codex model is `gpt-6.1-sol`, `gpt-5.4`, or `codex-mini` and the prompt role is `system`
- **THEN** the role becomes `developer` and `instructions` is not added

#### Scenario: A vendor prefix

- **WHEN** the Codex model ID is `openai/gpt-6.1-sol` and the prompt role is `system`
- **THEN** the role becomes `developer` and the model ID is unchanged

#### Scenario: Pi already sent developer

- **WHEN** a Codex request's prompt is already a developer message
- **THEN** the request is unchanged

### Requirement: Instructions are not rewritten

The extension MUST NOT add, remove, or rewrite `instructions`. The same role rename MUST apply to a native Codex compaction request. A request whose `model` field is not the current model ID MUST be left unchanged.

#### Scenario: An explicit instruction

- **WHEN** a Codex request has a system message and `instructions` set to `Focus on this turn.`
- **THEN** the message's role is `developer` and `instructions` remains `Focus on this turn.`

#### Scenario: Compaction

- **WHEN** native compaction runs on `gpt-6.1-sol` and its first input item is a system message
- **THEN** that item's role is `developer`, `compaction_trigger` remains last, and the request has no `instructions` field

### Requirement: Other APIs stay as Pi sent them

The extension MUST leave `openai-responses`, `openai-completions`, and `anthropic-messages` requests unchanged. There is no configuration switch. A `cacheCodexInstructions` key MUST be ignored.

#### Scenario: The OpenAI Responses API

- **WHEN** the model uses the OpenAI Responses API and the prompt role is `system`
- **THEN** the role stays `system`

#### Scenario: A leftover key

- **WHEN** a provider entry contains `cacheCodexInstructions`
- **THEN** configuration loading succeeds and that key does not change requests
