# Spec Delta

## Purpose

Let users experiment with independent request modes per provider and model, and explicitly save chosen preferences without making every toggle persistent.

## ADDED Requirements

### Requirement: Scoped configuration and inheritance

The extension SHALL read optional provider-level `requestModes` and provider-local `modelRequestModes` keyed by exact model ID (1–256 characters, no surrounding whitespace or control characters) from the existing `sub2api.json` path (including `PI_CODING_AGENT_DIR`). Each modes object SHALL accept optional `serviceTier` (`default`, `fast`, `ultrafast`) and `daybreak` (`standard`, `blue`). Resolution SHALL be field-by-field: temporary current-model override, saved model field, saved provider field, then no payload intervention. Invalid shapes or values SHALL fail configuration loading with a field-specific error without secrets.

#### Scenario: Partial model override

- **WHEN** a provider has Fast and Blue defaults and one model overrides only the tier to default
- **THEN** that model uses default tier and Blue, while other eligible models inherit Fast and Blue
- **AND** the same model ID under another provider uses only that other provider's preferences

#### Scenario: No configured preferences

- **WHEN** neither scope nor temporary state defines a field
- **THEN** that request field remains untouched

#### Scenario: Invalid preferences

- **WHEN** a modes field is null, has the wrong type, contains an unknown enum value, or a model override key violates the model ID constraints
- **THEN** loading reports the provider and offending field without exposing credentials

### Requirement: Temporary independent mode switches

Existing toggle commands SHALL modify only the selected provider/model's in-memory state and SHALL NOT write configuration. Fast and Ultrafast SHALL select a single tier; toggling the active tier off SHALL select default. Daybreak SHALL independently switch between Blue and standard, selecting Blue on the first toggle from an unspecified state. Temporary preferences SHALL survive model switches within the loaded extension and disappear on reload. Unsupported provider/model/API combinations SHALL be rejected by the affected toggle without changing state.

#### Scenario: Fast coexists with Daybreak

- **WHEN** the user enables Fast and then Daybreak on an eligible Responses model
- **THEN** requests contain `service_tier: "priority"` and `access_programs.cyber: "daybreak_blue"`
- **AND** the configuration file is unchanged

#### Scenario: Tier switches preserve Daybreak

- **WHEN** the user enables Ultrafast after Fast and Blue, on a supporting model
- **THEN** the tier becomes ultrafast and Blue stays enabled
- **AND** toggling Ultrafast again selects default without changing Blue

#### Scenario: Model switches and reload

- **WHEN** the user changes model A, switches to model B, then back to A
- **THEN** A retains its temporary modes and B has its own resolved modes
- **AND** reloading without saving restores saved preferences rather than A's temporary changes

### Requirement: Explicit scoped save

The extension SHALL register `/sub2api-save` and accept only no argument (current model) or `provider` (current provider defaults). It SHALL snapshot the current effective defined mode fields, replacing only the target modes object. It SHALL NOT persist other models' temporary changes, reasoning settings, or compaction settings. It SHALL NOT register `/save`, bind Ctrl+S, or automatically save on toggles, model switches, or shutdown. Missing/foreign/unsupported selected models and invalid arguments SHALL produce an error without writing. Save SHALL report its target and success or failure.

#### Scenario: Save current model and restart

- **WHEN** the user enables Fast and Blue and runs `/sub2api-save`
- **THEN** the selected provider's exact model entry stores both preferences
- **AND** a new extension instance restores them without toggling
- **AND** provider defaults and all other model entries are unchanged

#### Scenario: Save provider defaults

- **WHEN** the user runs `/sub2api-save provider`
- **THEN** the current effective defined fields replace that provider's default modes
- **AND** existing saved model overrides and other models' temporary overrides remain intact and retain precedence
- **AND** models without overrides inherit the new provider defaults

#### Scenario: Save explicit off states

- **WHEN** a model inherits Fast and Blue, the user disables both and saves the model
- **THEN** it stores default and standard, which override provider defaults after reload

#### Scenario: Invalid save invocation

- **WHEN** the user supplies an unknown argument or selects a model outside this extension's supported OpenAI request-mode paths
- **THEN** the command reports the problem and leaves disk and memory unchanged

### Requirement: Preserve configuration and failure safety

Saving SHALL preserve unrelated configuration and literal credential expressions, SHALL NOT serialize resolved credentials, and SHALL NOT leave a partially written destination file. A missing/malformed file, missing target provider, or write failure SHALL leave temporary preferences usable and SHALL NOT report success. Saves in one extension instance SHALL be serialized and SHALL merge the target update into a fresh raw read rather than the startup snapshot.

#### Scenario: Preserve secrets and unrelated edits

- **WHEN** the configuration contains an environment-reference or command token and another provider was edited before save
- **THEN** saving preserves that literal token and the other provider's latest contents

#### Scenario: Failed save

- **WHEN** reading, validating, or writing the destination fails
- **THEN** the command reports failure without logging secrets, keeps temporary state, and leaves the destination unmodified by this save

### Requirement: Apply resolved preferences consistently

Generation requests and footer indicators SHALL use the selected model's resolved modes with the existing protocol/model-ID guards. Fast SHALL map to priority, Ultrafast to ultrafast, default to default; Blue and standard SHALL map to their existing cyber values while preserving other access-program fields. Ultrafast and Daybreak SHALL NOT be injected into Chat Completions; unsupported APIs/models SHALL receive no mode injection or active mode indicators. The existing native compaction tier precedence SHALL remain explicit command tier, configured compaction tier, then resolved conversation tier. Daybreak SHALL NOT be added to native compaction. These protocol guards SHALL NOT be presented as proof of upstream model/account eligibility.

#### Scenario: Compaction fallback

- **WHEN** the conversation resolves to Fast and Blue and no compaction tier override exists
- **THEN** native compaction uses priority without adding Daybreak
- **AND** an explicit or configured compaction tier takes precedence without changing conversation preferences

#### Scenario: Unsupported protocol

- **WHEN** provider defaults contain Ultrafast and Blue but the selected model uses Chat Completions
- **THEN** neither unsupported field nor its active footer indicator is applied

#### Scenario: Accurate examples

- **WHEN** documentation or tests illustrate Ultrafast
- **THEN** they use clearly synthetic protocol fixtures or a real model whose capability was verified against an authoritative source
- **AND** they do not claim GPT-5.5 supports Ultrafast
