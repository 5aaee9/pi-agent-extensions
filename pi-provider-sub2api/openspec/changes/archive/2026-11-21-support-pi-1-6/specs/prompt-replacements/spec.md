## RENAMED Requirements

- FROM: ### Requirement: Matching rules replace literal instructions text
- TO: ### Requirement: Matching rules replace literal system prompt text

## MODIFIED Requirements

### Requirement: Replacements are optional per provider

A provider entry MAY omit `promptReplacements`. When the field is omitted or an empty array, that provider's requests MUST be sent unchanged.

#### Scenario: The field is omitted

- **WHEN** a provider entry has no `promptReplacements`
- **THEN** a request for any of its models keeps its original system prompt

#### Scenario: The list is empty

- **WHEN** `promptReplacements` is `[]`
- **THEN** requests for that provider are sent unchanged

### Requirement: Matching rules replace literal system prompt text

Rules MUST apply only to a model that uses the Codex Responses API. They MUST rewrite the system prompt where Pi sends it: the text of the request's system prompt item. That is the first `input` item, when it is a message with role `developer` or `system` and string content. For each matching rule, in declaration order, the extension MUST replace every occurrence of that rule's `from` text in that item's content with its `to` text. The search MUST be literal. A later rule MUST see the text earlier rules produced. Only that item's content MUST change. Every other `input` item, including later `developer` or `system` messages, and every other request field MUST keep its value. An empty `to` MUST remove the matched text.

#### Scenario: Declaration order

- **WHEN** the first matching rule replaces `AA` with `BB` and the next replaces `BB` with `CC`
- **THEN** a system prompt that was `AA` becomes `CC`

#### Scenario: The rest of the prompt stays

- **WHEN** `from` is one sentence inside a longer system prompt
- **THEN** only that sentence changes and the surrounding text stays

#### Scenario: Other payload fields stay

- **WHEN** the system prompt changes
- **THEN** `tools`, every other `input` item, and every other field keep their values

#### Scenario: A later system message is not rewritten

- **WHEN** `from` also occurs in a `developer` message that is not the first `input` item
- **THEN** that later message keeps its text

#### Scenario: An empty replacement deletes the text

- **WHEN** `to` is `""` and `from` occurs twice
- **THEN** both occurrences are removed and the request succeeds

#### Scenario: A request on Pi 1.6.0

- **WHEN** Pi 1.6.0 sends a Codex Responses turn for a matching model of a relay entry with a rule
- **THEN** the first `input` item of the request that reaches the relay carries the replaced text and not the original `from` text

#### Scenario: Another API is not rewritten

- **WHEN** the current model uses the OpenAI Responses, Chat Completions, or Anthropic Messages API
- **THEN** its request is unchanged, even if it contains `from`

### Requirement: A missing phrase is not an error

When a matching rule's `from` text is not in the system prompt, the extension MUST skip that rule and MUST NOT raise. Later rules MUST still run.

#### Scenario: The phrase is absent

- **WHEN** the system prompt does not contain `from`
- **THEN** the request is unchanged and no error is raised

#### Scenario: A later rule still applies

- **WHEN** the first matching rule's `from` is absent and a later matching rule's `from` is present
- **THEN** only the later replacement is applied

## REMOVED Requirements

### Requirement: Only a string instructions field is rewritten

**Reason**: Pi 1.6.0 no longer sends the Codex system prompt in a top-level `instructions` field, so rules have no `instructions` string to rewrite. Rewriting a top-level `instructions` field was the Pi ≤1.5.x path, and it is removed.

**Migration**: Use Pi 1.6.0 or newer. Existing `promptReplacements` configuration keeps working unchanged and applies to the system prompt item. On Pi 1.5.x, rules no longer apply.

## ADDED Requirements

### Requirement: Only a leading system prompt item with string content is rewritten

When the request has no `input` array, or its first `input` item is not a message with role `developer` or `system` and string content, the extension MUST leave the request unchanged and MUST NOT raise. A top-level `instructions` field MUST NOT be rewritten.

#### Scenario: No system prompt item

- **WHEN** the first `input` item is a user message
- **THEN** the payload is unchanged

#### Scenario: Non-string content

- **WHEN** the first `input` item is a `developer` message whose content is an array
- **THEN** the payload is unchanged

#### Scenario: A top-level instructions field

- **WHEN** the payload has an `instructions` string containing `from` and no system prompt item
- **THEN** the payload is unchanged
