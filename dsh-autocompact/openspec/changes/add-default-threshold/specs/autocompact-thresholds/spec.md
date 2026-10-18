# Spec Delta

## ADDED Requirements

### Requirement: A deployment default threshold covers models without their own

The plugin's row configuration SHALL accept an optional `defaultLimit`, a positive integer token count. When set, it SHALL be the threshold for every exact `provider/model` route with no entry in `modelLimits`; when absent, no default applies and those routes keep the backend's own automatic compaction. `defaultLimit` SHALL be declared `.volatile()` and read through its live reference on every use, like `modelLimits`.

#### Scenario: A model without its own threshold inherits the default

- **WHEN** `defaultLimit` is 300000 and the session's route has no `modelLimits` entry
- **THEN** the effective threshold for that route is 300000 tokens
- **AND** `/autocompact` reports it as coming from the deployment default

#### Scenario: Without a default the model is not covered

- **WHEN** `defaultLimit` is unset and the session's route has no `modelLimits` entry
- **THEN** no plugin threshold applies to that route and the pressure check does not compact
- **AND** the composer's status entry takes no seat for that model

#### Scenario: A saved default reaches the running plugin

- **WHEN** the Settings section sets or clears `defaultLimit` while the plugin is loaded
- **THEN** the next pressure check and the next `/autocompact` answer use the new value without a reload

### Requirement: The effective threshold follows a fixed precedence

For one session and one exact route the effective threshold SHALL be resolved as: the session override when one exists (including an explicit `off`, which suppresses every fallback), otherwise the route's `modelLimits` entry, otherwise `defaultLimit`, otherwise no threshold. A per-model entry SHALL keep winning over the deployment default, and a session command SHALL keep winning over both for the rest of the session.

#### Scenario: The per-model entry wins over the default

- **WHEN** `defaultLimit` is 300000 and `modelLimits` contains 400000 for the session's route
- **THEN** the effective threshold for that route is 400000 tokens

#### Scenario: The session override wins over both

- **WHEN** a default and a per-model entry are configured and the user runs `/autocompact 250k`
- **THEN** the effective threshold in that session is 250000 tokens

#### Scenario: Off suppresses the default for the session

- **WHEN** a default is configured and the user runs `/autocompact off`
- **THEN** no threshold applies to that route for the rest of the session, and `/autocompact default` restores the default

### Requirement: A malformed deployment default fails the plugin load

`defaultLimit` SHALL be validated at load as a positive safe integer when present. A zero, a negative, a fractional, or a non-numeric value SHALL fail the plugin's load with an error naming the field, rather than being discovered at the first measured step. Unsetting the field SHALL be accepted and restore the no-default behavior.

#### Scenario: A default below one token

- **WHEN** the row configuration sets `defaultLimit` to 0
- **THEN** loading the plugin fails with an error naming `defaultLimit`

#### Scenario: A default is removed

- **WHEN** a valid `defaultLimit` is unset through the Settings section
- **THEN** the plugin loads and behaves as if no default had ever been configured

### Requirement: The deployment default is validated against each route's real capacity

Before the pressure check acts on a threshold derived from `defaultLimit`, it SHALL run the same validation as a session threshold: the value must exceed the backend's retained-tail budget for that route and stay below the route's real context window. A default that does not fit one route SHALL leave that route uncompacted and warn once per session, without disabling the default for other routes.

#### Scenario: A default that is too large for a small-window route

- **WHEN** `defaultLimit` is 500000 and the session's route has a 128000-token context window
- **THEN** that route is not compacted, and the session warns once that the threshold must be less than the context window
- **AND** a route whose window accommodates the default still compacts at it
