# Spec Delta

## Purpose

Define the model metadata `@indexyz/dsh-custom-provider-reasoning-efforts` fills from an endpoint listing beside its capability declarations: which fields discovery reads, how a discovered value reaches a declared model entry without overriding an authored one, how listing and Codex manifest answers combine, and why `clear` leaves the metadata alone.

## ADDED Requirements

### Requirement: Discovery reads the metadata a listing entry publishes

The plugin's endpoint interrogation SHALL read each model entry's display name, context capacity, and output cap from the spellings the Harness's own model discovery reads — the name from `name`, `display_name`, or `displayName`; the context from `contextWindow`, `context_window`, `context_length`, `max_input_tokens`, `limit.context`, or `limits.context`; the output cap from `maxOutputTokens`, `max_output_tokens`, `maxTokens`, `max_tokens`, `limit.output`, `limits.output`, or `top_provider.max_completion_tokens` — on both the standard model listing and the Codex-shaped capability manifest. A candidate SHALL be used only when it is a positive integer (for the two caps) or a non-empty string (for the name); every other value is ignored rather than coerced, and an entry that publishes none of the fields yields no metadata.

#### Scenario: The Codex manifest sizes a model

- **WHEN** a manifest entry carries `display_name: "GPT-6.1-Sol"` and `context_window: 500000`
- **THEN** discovery reads that name and context window for the model id

#### Scenario: A listing publishes a nested limit

- **WHEN** a listing entry carries `limit: {context: 128000, output: 16384}`
- **THEN** discovery reads a 128000 context window and a 16384 output cap

#### Scenario: A non-positive capacity

- **WHEN** a listing entry carries `context_window: 0`
- **THEN** no context window is read from that field, and the next candidate (or no value) decides

### Requirement: A discovered metadata value fills only an absent entry field

Planning SHALL write a discovered metadata value only when the profile's model entry does not already carry that field, and SHALL leave an authored value untouched even when it differs from what the endpoint publishes. A metadata intent SHALL NOT be reported as a change when the field is present, and SHALL NOT be reported as a skip either: the profile already answers the question. Metadata intents SHALL come only from discovery — `status` and `apply` without a probe SHALL plan the declaration tables' capability fields only — and they SHALL address only models the route's explicit `models` list declares.

#### Scenario: A bare entry gains its context window

- **WHEN** a declared model entry carries no `contextWindow` and the manifest publishes 500000
- **THEN** the entry gains `contextWindow: 500000` and the change is reported with its field

#### Scenario: An authored value is kept

- **WHEN** a declared model entry carries `contextWindow: 256000` and the manifest publishes 500000
- **THEN** the entry keeps 256000 and no metadata change is reported for it

#### Scenario: A model the route does not declare

- **WHEN** the manifest describes a model the route's explicit `models` list does not contain
- **THEN** no entry is created and no metadata is written for that model

### Requirement: Listing and manifest metadata combine with the listing winning

When the same model appears in both the standard listing and the Codex manifest, the merged entry SHALL carry the listing's own value for each metadata field it publishes and the manifest's value only for the fields the listing leaves out; a field neither source publishes stays absent. The merge SHALL NOT turn the manifest's presence into a reason to overwrite a listing answer.

#### Scenario: The listing and manifest disagree

- **WHEN** the listing publishes `context_window: 400000` and the manifest publishes 500000 for the same model
- **THEN** the merged entry carries 400000

#### Scenario: Only the manifest answers

- **WHEN** the listing publishes no name and the manifest carries `display_name`
- **THEN** the merged entry carries the manifest's name

### Requirement: Discovered metadata does not participate in clear

The clear mode SHALL remove exactly the `reasoningEfforts` and `input` fields the plugin's declaration tables name, and SHALL leave every discovered metadata field (`name`, `contextWindow`, `maxTokens`) in place, because a written value cannot be distinguished from one the deployment authored and removing it would erase configuration the plugin did not own.

#### Scenario: Clear keeps a discovered context window

- **WHEN** a model entry carries a discovered `contextWindow` and the user runs the clear mode
- **THEN** the `contextWindow` stays and only the declared capability fields are removed

### Requirement: Metadata changes render with their field

Every reported change SHALL name the model-entry field it belongs to, so a metadata change is legible beside capability changes in one answer: a context window renders as its number, a name as its string, and a removed or filled capability keeps its existing rendering.

#### Scenario: One answer shows a context window fill

- **WHEN** a discovery pass fills one context window beside one vision change
- **THEN** the answer names `contextWindow` and `input` on their respective changes
