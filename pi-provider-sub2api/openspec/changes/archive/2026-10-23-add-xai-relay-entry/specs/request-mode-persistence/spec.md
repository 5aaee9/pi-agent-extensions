# request-mode-persistence Spec Delta

## ADDED Requirements

### Requirement: xAI entry request-mode eligibility

Explicit `api: "xai"` entries SHALL keep valid stored request-mode preferences inactive for every model ID. Their requests and footer SHALL receive no mode injection or active mode indicators. `/toggle-fast`, `/toggle-ultrafast`, `/toggle-daybreak`, and `/sub2api-save` SHALL reject an xAI selection without changing memory or disk. Other entry types SHALL retain their existing behavior.

#### Scenario: Stored preferences on an xAI model

- **WHEN** an xAI entry has valid provider or model request-mode preferences
- **THEN** those preferences remain stored but do not affect its requests or footer
- **AND** this behavior is unchanged when the model uses a relay alias

#### Scenario: Mode command while xAI is selected

- **WHEN** the user invokes a mode toggle or save command on an xAI model
- **THEN** the command explains that the selected entry is unsupported and leaves all entries’ preferences and configuration unchanged
