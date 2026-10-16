# Spec Delta

## Purpose

Define the composer status pill of `@indexyz/dsh-autocompact`: the ambient entry that shows the current session's route, threshold, and measured context pressure, when it takes a seat in the composer's row, and how a click reaches the Settings section that owns the editor.

## ADDED Requirements

### Requirement: The pill reads the session's route and context pressure

The client half SHALL register an entry in the composer's ambient row (`conversation.composer.dock`) that reads the session's current route from the `modelSelection` projection and the measured pressure from the `contextPressure` projection, and subscribes to the same configuration store the Settings section writes to, so a save in Settings updates the reading immediately. The pill SHALL show the measured pressure first and the threshold that triggers compaction second (`128K / 300K`), the threshold alone when no request has reported usage yet, and the disabled state when the master switch is off. The counts SHALL use the same `{value}K`/`{value}M` units as the composer's own readings.

#### Scenario: A threshold applies and pressure is known

- **WHEN** the session's route has a configured threshold and the context pressure projection reports a measurement
- **THEN** the pill shows the measurement and the threshold, in the composer's own count units

#### Scenario: A threshold applies with no measurement yet

- **WHEN** the route has a configured threshold and no request has reported usage
- **THEN** the pill shows the threshold alone

#### Scenario: The master switch is off

- **WHEN** the row's `enabled` is false
- **THEN** the pill shows the disabled state for every model, whatever route the session uses

#### Scenario: A save updates the pill

- **WHEN** the user changes a threshold in the Settings section
- **THEN** the pill reflects the new persisted value without a reload

### Requirement: The pill takes a seat only when it has something to report

The pill SHALL render nothing while the row is absent, while the row cannot be read, or while the session's route has no threshold under an enabled switch, because the composer's ambient row is shared with the session's own turn, token, and context readings and an inert entry is noise. It SHALL be dressed as one of the host's ambient readings: the host's own icon artwork, the ambient pill's padding, radius, and tertiary label colour, a density-aware type size and icon size, and no occurrence of the plugin's own name in its text; the icon identifies the entry and the tooltip carries the meaning. Its accessible name and tooltip SHALL state the route and what the number means, and what a click does.

#### Scenario: A model with no threshold

- **WHEN** the master switch is on and the session's route has no configured threshold
- **THEN** the pill renders nothing and the composer row is unchanged

#### Scenario: The configuration cannot be read

- **WHEN** the row is absent from the profile or the read fails
- **THEN** the pill renders nothing and never throws into the composer row

#### Scenario: The reading carries no plugin name

- **WHEN** the pill's rendered text and tooltip are inspected
- **THEN** they name the session's route, the numbers, and the click action, and do not contain the plugin's name

### Requirement: Clicking the pill opens the Settings section, with a registered panel as its fallback

On click the pill SHALL first attempt to open the settings shell on this plugin's section: read the slot registry's entries for the settings shell's cell, and for each entry whose store declares the shell's `openSection` action, create the live store instance and invoke `openSection` with the plugin's section id. Only when no such store answers SHALL it select the central panel this plugin registers under the same key through the layout service. Every step SHALL be guarded, so a renamed cell, a renamed action, or a composition without the settings shell leaves the reading rendered and the click inert rather than throwing. Both destinations SHALL render the same editor component from the same store.

#### Scenario: The settings shell is present

- **WHEN** the pill is clicked in the full web profile
- **THEN** the Settings panel opens on the Autocompact section, using the shell's own store action

#### Scenario: The store cannot be reached

- **WHEN** the settings shell's cell or action is unavailable, or the profile mounts no settings
- **THEN** the plugin's own central panel is selected instead, rendering the same editor

#### Scenario: Neither destination exists

- **WHEN** no settings store and no layout service are available
- **THEN** the click changes nothing, the reading still renders, and nothing throws

### Requirement: The pill survives its own failure

The pill SHALL render inside its own error boundary, which logs the failure and renders nothing, so a failure in a decorative widget can never take the composer's ambient row down. A failure while reading a projection or opening a destination SHALL be caught in place.

#### Scenario: A projection read fails

- **WHEN** reading the route or the pressure projection throws
- **THEN** the boundary logs the failure, renders nothing for this pill, and the composer row keeps rendering its own readings

#### Scenario: Opening the destination fails

- **WHEN** the settings store or the layout service throws while the pill opens a destination
- **THEN** the failure is logged and the pill keeps rendering its reading
