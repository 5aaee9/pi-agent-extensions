# Spec Delta

## ADDED Requirements

### Requirement: The Settings section offers a deployment default field

The Settings section SHALL render one **Default threshold** editor above the per-model
list, showing the persisted `defaultLimit` in the same `300k`/`1m` grammar as every other
threshold, with the same busy and read-only handling. A blank field SHALL mean "no
default".

#### Scenario: The persisted default is shown

- **WHEN** the row's `defaultLimit` is 300000 and the section opens
- **THEN** the default field reads `300k` in the page's grammar

#### Scenario: A per-model row still wins

- **WHEN** the default is 300k and a model row holds 400k
- **THEN** the section's per-model row keeps its own value and the default stays a separate field

#### Scenario: A read-only profile

- **WHEN** the profile reports itself as not writable
- **THEN** the default field renders disabled with the rest of the editor's controls

### Requirement: A saved default is written as a set or unset operation

Saving a field value SHALL set `defaultLimit` to the parsed token count, and saving a blank
field where a value was persisted SHALL unset it, both through the existing
revision-guarded settings write. An unparsable value SHALL be rejected with the existing
invalid-value notice and SHALL write nothing. A successful save SHALL be visible to the
composer status entry immediately.

#### Scenario: A default threshold is added

- **WHEN** the user enters `300k` in the default field and saves
- **THEN** the row's `defaultLimit` is 300000 and the composer entry applies it to models without their own threshold

#### Scenario: A default threshold is cleared

- **WHEN** a persisted default is selected, emptied, and saved
- **THEN** the row's `defaultLimit` is removed and models without their own threshold stop being compacted by the plugin

#### Scenario: An invalid default is rejected

- **WHEN** the user enters `banana` in the default field and saves
- **THEN** the section shows the invalid-value notice and writes nothing
