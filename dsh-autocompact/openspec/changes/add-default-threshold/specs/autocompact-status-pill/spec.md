# Spec Delta

## ADDED Requirements

### Requirement: The pill resolves a per-model threshold before the deployment default

The composer status entry SHALL resolve the configured threshold for the session's route
as the route's `modelLimits` entry when present, otherwise `defaultLimit`. A per-model
entry SHALL keep winning over the deployment default.

#### Scenario: A per-model entry is shown instead

- **WHEN** the route has a per-model entry of 400000 and the default is 300000
- **THEN** the pill shows `400K`

#### Scenario: The default gives an uncovered model a reading

- **WHEN** `defaultLimit` is 300000 and the session's route has no per-model entry
- **THEN** the pill shows `300K`, or the measured pressure and `300K` once usage is reported

### Requirement: The pill takes a seat only when a threshold resolves

When neither a per-model entry nor a deployment default applies to the session's route,
the pill SHALL take no seat in the composer's ambient row, as it does today. It SHALL
continue to update immediately when a save changes either value.

#### Scenario: No default and no per-model entry

- **WHEN** `defaultLimit` is unset and the session's route has no per-model entry
- **THEN** the pill takes no seat in the composer's ambient row

#### Scenario: A saved default brings the pill back

- **WHEN** a default is saved while the session's route has no per-model entry
- **THEN** the pill renders the reading without a reload

### Requirement: The master switch still wins over the deployment default

A disabled master switch SHALL keep reporting the disabled state for every model, whatever
the deployment default says.

#### Scenario: The master switch is off with a default configured

- **WHEN** `defaultLimit` is set and the master switch is off
- **THEN** the pill shows the disabled state rather than the default threshold
