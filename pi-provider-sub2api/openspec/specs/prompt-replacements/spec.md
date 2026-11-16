# prompt-replacements Specification

## Purpose
Lets a relay replace chosen text in a model's outgoing instructions without changing the rest of the prompt or the request.

## Requirements

### Requirement: Replacements are optional per provider

A provider entry MAY omit `promptReplacements`. When the field is omitted or an empty array, that provider's requests MUST be sent unchanged.

#### Scenario: The field is omitted

- **WHEN** a provider entry has no `promptReplacements`
- **THEN** a request for any of its models keeps its original `instructions`

#### Scenario: The list is empty

- **WHEN** `promptReplacements` is `[]`
- **THEN** requests for that provider are sent unchanged

### Requirement: A rule names models by ID or wildcard

Each rule's `models` list MUST accept exact model IDs and patterns in which `*` matches any sequence of characters, including none. Every other character MUST match itself. A pattern MUST match the whole model ID, comparison MUST be case-sensitive, and a rule MUST match when any of its patterns matches.

#### Scenario: A family wildcard

- **WHEN** `models` contains `gemini-*`
- **THEN** the rule matches `gemini-2.5-pro` and does not match `gemini` or `my-gemini-2.5-pro`

#### Scenario: An exact ID

- **WHEN** `models` contains `gpt-5.4`
- **THEN** the rule matches `gpt-5.4` and does not match `gpt-5.4-mini` or `gpt-5X4`

#### Scenario: A star matches every model of the provider

- **WHEN** `models` contains `*`
- **THEN** the rule matches every model ID of that provider

### Requirement: Patterns follow model ID limits

Each pattern MUST be a non-empty string of at most 256 characters, with no leading or trailing whitespace and no control characters.

#### Scenario: A blank pattern

- **WHEN** `models` contains `""`
- **THEN** loading fails with an error that names the provider and `promptReplacements`

#### Scenario: Surrounding whitespace

- **WHEN** `models` contains ` gemini-*`
- **THEN** loading fails with an error that names the provider and `promptReplacements`

### Requirement: A rule applies only to its provider and model

The extension MUST apply a rule only when the current model belongs to the provider that declares the rule and the model ID matches that rule. A request whose `model` field is not the current model ID MUST be left unchanged.

#### Scenario: The same model ID on another provider

- **WHEN** provider A declares a matching rule and the current model uses that ID under provider B
- **THEN** provider B's request is unchanged

#### Scenario: The payload names another model

- **WHEN** the request's `model` field is not the current model ID
- **THEN** the request is unchanged

### Requirement: Matching rules replace literal instructions text

For each matching rule, in declaration order, the extension MUST replace every occurrence of that rule's `from` text in the `instructions` string with its `to` text. The search MUST be literal. A later rule MUST see the text earlier rules produced. No other request field MUST change. An empty `to` MUST remove the matched text.

#### Scenario: Declaration order

- **WHEN** the first matching rule replaces `AA` with `BB` and the next replaces `BB` with `CC`
- **THEN** instructions that were `AA` become `CC`

#### Scenario: The rest of the prompt stays

- **WHEN** `from` is one sentence inside a longer `instructions` string
- **THEN** only that sentence changes and the surrounding text stays

#### Scenario: Other payload fields stay

- **WHEN** `instructions` changes
- **THEN** `tools`, `input`, and every other field keep their values

#### Scenario: An empty replacement deletes the text

- **WHEN** `to` is `""` and `from` occurs twice
- **THEN** both occurrences are removed and the request succeeds

### Requirement: A missing phrase is not an error

When a matching rule's `from` text is not in `instructions`, the extension MUST skip that rule and MUST NOT raise. Later rules MUST still run.

#### Scenario: The phrase is absent

- **WHEN** `instructions` does not contain `from`
- **THEN** the request is unchanged and no error is raised

#### Scenario: A later rule still applies

- **WHEN** the first matching rule's `from` is absent and a later matching rule's `from` is present
- **THEN** only the later replacement is applied

### Requirement: Only a string instructions field is rewritten

When `instructions` is missing or is not a string, the extension MUST leave the request unchanged and MUST NOT raise.

#### Scenario: Instructions is absent

- **WHEN** the payload has no `instructions` field
- **THEN** the payload is unchanged

#### Scenario: Instructions is not a string

- **WHEN** `instructions` is an array or an object
- **THEN** the payload is unchanged

### Requirement: Unknown rule fields are ignored

A rule MAY contain fields other than `models`, `from`, and `to`. The extension MUST ignore those fields and MUST still apply `models`, `from`, and `to`.

#### Scenario: An extra field

- **WHEN** a rule includes a field other than `models`, `from`, and `to`
- **THEN** the rule still replaces `from` with `to`

### Requirement: Invalid replacement configuration fails loading

The extension MUST reject a `promptReplacements` value that is not an array, a rule that is not an object, a `models` value that is missing or not a non-empty array of valid patterns, a `from` value that is not a non-empty string, and a `to` value that is not a string. The error MUST name the provider and the field and MUST NOT include the configured token.

#### Scenario: An empty from

- **WHEN** a rule's `from` is `""`
- **THEN** loading fails with an error that names the provider and `from`

#### Scenario: The token stays out of the error

- **WHEN** the entry has a token and `promptReplacements` is invalid
- **THEN** the error does not contain that token
