# Spec Delta

## Purpose

Define the Settings section of `@indexyz/dsh-autocompact`: the page that edits the deployment's persisted per-model thresholds through the Host settings namespace, how its writes are guarded, what it does when the row or the catalog is unavailable, and the strings and theming it ships.

## ADDED Requirements

### Requirement: The Settings section edits the persisted per-model thresholds

The client half SHALL register a `settings.section` entry whose id is the plugin's namespace (`@indexyz/dsh-autocompact`), ordered with the host's own settings sections and labeled from the plugin's dictionary. The section SHALL read the bundle row through the Host `settings` namespace and render a master switch for all configured thresholds, one row per exact `provider/model` route with its threshold in tokens editable in place and removable, and an add-model control. Adding a model SHALL offer the live model catalog when the session namespace provides one and SHALL offer a manual `provider/model` field when it does not. A successful save SHALL be visible to every other surface of this half without a second round trip. The section MUST NOT write anything other than the row's `modelLimits` and `enabled`.

#### Scenario: A threshold is added and saved

- **WHEN** the user adds a route with the threshold `300k` and saves
- **THEN** the row's `modelLimits` contains that exact `provider/model` key with the token count, and the composer pill reflects it immediately

#### Scenario: A threshold is edited in place

- **WHEN** the user changes an existing row's count and saves
- **THEN** the persisted value is replaced and no other route's entry changes

#### Scenario: A threshold is removed

- **WHEN** the user removes a row and saves
- **THEN** that route's entry is gone from the persisted `modelLimits`

#### Scenario: The master switch

- **WHEN** the user turns the master switch off and saves
- **THEN** `enabled` is false and every configured threshold stops applying

### Requirement: Writes go through the Host settings namespace, guarded by the row revision

The client half SHALL reach the namespace as its own injected service (`remote.settings`), declared in `inject`, rather than as a property of the `remote` service, and SHALL tolerate a namespace that is not mounted by returning `undefined` instead of throwing. Every write SHALL address the namespace the Host reported and SHALL carry the row revision the section last read. A response that reports a revision conflict SHALL reload the current values and tell the user they changed elsewhere, rather than overwriting them. A profile that reports itself as not writable SHALL render the section read-only. The row's `modelLimits` and `enabled` SHALL be the fields declared `.volatile()` in the plugin's `Config`, because the Host settings service lists only rows that declare a volatile field and accepts writes only to volatile paths, and because a volatile field is what makes a saved edit reach the loaded plugin.

#### Scenario: A concurrent edit is not clobbered

- **WHEN** the section saves with a revision the Host no longer holds
- **THEN** it reloads the current values, reports the conflict, and writes nothing

#### Scenario: A read-only profile

- **WHEN** the profile reports `writable: false`
- **THEN** the section renders the current values with its controls disabled and explains why they cannot be edited

#### Scenario: The namespace is not mounted

- **WHEN** the deployment exposes no `settings` namespace, or no autocompact row
- **THEN** the section renders an absent-row state that explains how to install the bundle, and nothing throws

### Requirement: The section owns its failure face

The section SHALL render inside its own error boundary, which catches a rendering failure, shows the message and stack in place of the page, and logs it, so a failure never leaves an empty page or retires the slot entry. A failed `describe` or write SHALL render its own error state inside the section rather than throwing out of the render.

#### Scenario: A rendering failure is contained

- **WHEN** a child of the section throws while rendering
- **THEN** the section shows the failure in place of its body and the Settings panel stays usable

### Requirement: The section ships its own localized strings and uses host theme tokens

The client half SHALL ship at least English and Chinese dictionaries for its labels, hints, notices, and error states, registered through the locale service under the plugin's namespace and bound to the section's translator. Its styles SHALL be built from the host's theme tokens, using the documented token as a fallback where the Theme provider does not publish one, so that a rename degrades the appearance instead of erasing it. The client half MUST NOT import any Harness client package; the only external module it may reference is the page-provided `react` and its JSX runtime.

#### Scenario: Both locales render

- **WHEN** the host locale is English or Chinese
- **THEN** the section's title, rows, hints, notices, and crash face render from that language's dictionary
- **AND** a missing entry degrades to visible text rather than a crash

#### Scenario: No Harness client import

- **WHEN** the client half's imports are inspected
- **THEN** it imports only `react` and its own relative modules
- **AND** the built `client.js` requests no module beyond the page's module table

#### Scenario: A renamed theme token

- **WHEN** a theme token the section prefers is not published by the running theme
- **THEN** the documented fallback token is used and the section still renders
