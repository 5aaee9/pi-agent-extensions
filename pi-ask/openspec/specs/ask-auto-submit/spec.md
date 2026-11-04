# ask-auto-submit Specification

## Purpose

Define when a fully answered ask flow submits itself, whichever key answered its last question.

## Requirements

### Requirement: Auto-submit does not depend on how a question was answered

With `behaviour.autoSubmitWhenAnsweredWithoutNotes` enabled, a flow answered with no notes SHALL submit when the last answer lands on the review tab, whether it was given with a digit or by confirming.

#### Scenario: A digit answers the last question

- **WHEN** the setting is on and a digit answers the only question
- **THEN** the answer reaches the model without another key press

#### Scenario: The setting is off

- **WHEN** the setting is off and a digit answers the only question
- **THEN** the form stays on the review tab until the user confirms
