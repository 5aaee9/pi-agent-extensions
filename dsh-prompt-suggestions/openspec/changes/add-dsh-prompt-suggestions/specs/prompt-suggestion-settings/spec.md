# Spec Delta

## Purpose

Expose a persisted global enable switch for next-message suggestions in the Harness General settings surface.

## ADDED Requirements

### Requirement: General settings switch

The plugin SHALL register one General settings row with a labeled enable switch. The switch SHALL reflect the Host configuration, save immediately, and affect generation and ghost text without a restart.

#### Scenario: Switch rendered

- **WHEN** the user opens Settings → General
- **THEN** the row shows the localized label, description, and current enabled state

#### Scenario: Switch toggled

- **WHEN** the user toggles the switch
- **THEN** the plugin persists the new `enabled` value and the composer overlay reflects it

### Requirement: Revision-guarded persistence

The settings row SHALL send the reviewed namespace revision with every write. A revision conflict MUST reload the accepted values before another write; a rejected write MUST restore the last accepted switch value and report the failure.

#### Scenario: Successful save

- **WHEN** the user toggles the switch and the Host accepts the update
- **THEN** the row reports success and keeps the new value

#### Scenario: Revision conflict

- **WHEN** the Host reports a settings conflict
- **THEN** the row reloads the accepted namespace, reports the conflict, and uses the reloaded revision for the next attempt

#### Scenario: Write failure

- **WHEN** the Host or transport rejects the update
- **THEN** the row restores the last saved value and reports the error

### Requirement: Read-only and unavailable settings

The switch SHALL be disabled when the profile is read-only, the namespace is unavailable, or the settings service is absent. The row MUST report that state without crashing the settings page.

#### Scenario: Read-only profile

- **WHEN** the settings description says the profile is not writable
- **THEN** the switch is disabled and the row reports read-only status

#### Scenario: Settings unavailable

- **WHEN** the settings service or namespace cannot be loaded
- **THEN** the switch is disabled, the row reports failure, and the rest of the settings page remains usable

### Requirement: Localization and containment

The row SHALL provide English and Chinese copy for its label, description, switch name, hints, and status. A rendering failure in the row or overlay MUST be contained by a local error boundary rather than taking down the settings page or composer.

#### Scenario: Chinese locale

- **WHEN** the active locale is Chinese
- **THEN** the row displays the Chinese label, description, and status copy

#### Scenario: Rendering failure

- **WHEN** the row or overlay component throws while rendering
- **THEN** the failure is contained locally and the host surface stays usable
