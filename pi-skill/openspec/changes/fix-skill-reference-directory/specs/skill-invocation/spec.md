# Spec Delta

## Purpose

Define what the model receives when a prompt references a loaded skill with a `$name` token.

## ADDED Requirements

### Requirement: A skill token matches Pi's skill command

A `$name` token for a loaded skill SHALL give the model the same `<skill>` block as `/skill:name`, in its own message ahead of the prompt, with the prompt text unchanged.

#### Scenario: Token and command send the same block

- **WHEN** a prompt `$known hi` and a prompt `/skill:known hi` run in separate sessions
- **THEN** both requests carry an identical `<skill name="known">` block, including `References are relative to` the skill's directory
- **AND** the `$known hi` request carries the block as a user message directly before the user message `$known hi`

### Requirement: A doubled dollar sign does not invoke a skill

`$$name` SHALL NOT invoke a skill, and SHALL reach the model exactly as written.

#### Scenario: Doubled dollar sign reaches the model as written

- **WHEN** a prompt `$$known hi` runs and a skill `known` is loaded
- **THEN** the request carries the user message `$$known hi` and no skill block
