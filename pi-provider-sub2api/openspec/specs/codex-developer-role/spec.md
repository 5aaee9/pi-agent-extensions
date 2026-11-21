# codex-developer-role Specification

## Purpose

Keep Pi's own GPT-6.2 Codex prompt in `input` when Pi would otherwise send it as `system`, without writing top-level `instructions` or copying a gateway prompt.

## Requirements

### Requirement: A covered model ID is GPT-6.2 or newer

The extension MUST treat a Codex model as covered only when its canonical ID is `gpt-` with a major version above 6, or major version 6 with a minor version of at least 2. Canonicalization MUST trim the ID, keep the segment after the last `/`, ignore case, and treat `_` and whitespace as `-`. A model without a minor version counts as minor version 0.

#### Scenario: A later alias

- **WHEN** the model ID is `openai/GPT-6.2-Sol` or `gpt-7`
- **THEN** the model is covered

#### Scenario: An older alias

- **WHEN** the model ID is `gpt-6` or `gpt-6.1-sol`
- **THEN** the model is not covered

### Requirement: Covered Codex requests keep system text in input

On a covered `openai-codex-responses` model, the extension MUST change every `system` item's role to `developer` before the request is sent. The item's content and its position relative to other existing items MUST stay the same. A request that contains no `system` item MUST be left unchanged. Applying the rename twice MUST NOT change the request again.

#### Scenario: Pi sent a system prompt

- **WHEN** a `gpt-6.2-sol` Codex request starts with a system message and has no `instructions` field
- **THEN** that message's role is `developer`, its content is unchanged, and the request still has no `instructions` field

#### Scenario: Pi already sent developer

- **WHEN** a covered request's prompt is already a developer message
- **THEN** the request is unchanged

### Requirement: Instructions are not rewritten

The extension MUST NOT add, remove, or rewrite `instructions`. The same role rename MUST apply to a native Codex compaction request. A request whose `model` field is not the current model ID MUST be left unchanged.

#### Scenario: An explicit instruction

- **WHEN** a covered request has a system message and `instructions` set to `Focus on this turn.`
- **THEN** the message's role is `developer` and `instructions` remains `Focus on this turn.`

#### Scenario: Compaction

- **WHEN** native compaction runs on `gpt-6.2-sol` and its first input item is a system message
- **THEN** that item's role is `developer`, `compaction_trigger` remains last, and the request has no `instructions` field

### Requirement: Other requests stay as Pi sent them

The extension MUST leave a request unchanged when the model is older than GPT-6.2, the API is not Codex Responses, or the payload does not belong to the current model. There is no configuration switch. A `cacheCodexInstructions` key MUST be ignored.

#### Scenario: An older Codex model

- **WHEN** the model ID is `gpt-5.4` or `gpt-6.1-sol` and the prompt role is `system`
- **THEN** the role stays `system` and `instructions` is not added

#### Scenario: Another API

- **WHEN** the model uses the OpenAI Responses API
- **THEN** a system message stays a system message

#### Scenario: A leftover key

- **WHEN** a provider entry contains `cacheCodexInstructions`
- **THEN** configuration loading succeeds and that key does not change requests
