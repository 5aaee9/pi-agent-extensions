# Spec Delta

## Purpose

Define the session-scoped, per-model automatic-compaction threshold of `@indexyz/dsh-autocompact`: what the `/autocompact` command accepts and reports, where its defaults come from, and which checks a threshold must pass before the plugin promises it has an effect.

## ADDED Requirements

### Requirement: The `/autocompact` command sets a session-only per-model threshold

The host half SHALL register a command named `autocompact`, identified as `@indexyz/dsh-autocompact`, with the hint `300k | off | default`. `/autocompact <count>` SHALL accept `300k`, `0.3m`, or an absolute count (`k` and `m` are decimal units) and SHALL set an absolute token threshold for the current session and the exact routed `provider/model` only. `/autocompact off` SHALL store an explicit override that suppresses the global default for that route in this session, and `/autocompact default` SHALL clear the session override and inherit the global default again. `/autocompact` without an argument SHALL report the current state. Overrides SHALL be keyed by the exact `provider/model` route and held in memory for the session object, so switching models preserves each model's override and a new, resumed, or forked session starts clean. The command MUST NOT write configuration, append a threshold entry to the session log, reload plugins, or modify the model's real context-window metadata, and it SHALL say so in its result.

#### Scenario: A session threshold is set

- **WHEN** the user runs `/autocompact 300k` in a session whose route is `deepseek/x`
- **THEN** the effective threshold for `deepseek/x` in that session is 300000 tokens
- **AND** the answer names the route, the threshold, that it comes from the session, and the backend's automatic-compaction state

#### Scenario: Two models in one session

- **WHEN** the user sets a threshold for one route and later switches the session to another model
- **THEN** the first route keeps its session override and the second model's threshold is its global default, if any

#### Scenario: A session override is not configuration

- **WHEN** `/autocompact 300k` has run
- **THEN** the deployment's configuration and the bundle row are unchanged
- **AND** a new session for the same route starts from the global default

#### Scenario: Off for this session only

- **WHEN** a route has a global default and the user runs `/autocompact off`
- **THEN** no threshold applies to that route for the rest of the session, and `/autocompact default` restores the global default

### Requirement: Global defaults come from the bundle row's configuration

The plugin's row configuration SHALL provide optional global defaults: `modelLimits` (a map of exact `provider/model` keys to positive integer token counts, default `{}`), `retainTokens` (the recent-tail fallback budget, default `20000`), and `enabled` (the master switch for the automatic pressure check, default `true`). `modelLimits` and `enabled` SHALL be declared `.volatile()` so the Host settings service lists the row and accepts edits to them, and both SHALL be read through their live references on every use so a saved Settings edit reaches the running plugin without a restart. `retainTokens` SHALL stay ordinary configuration. Misconfigured defaults SHALL fail the plugin's load rather than the first measured step. The command SHALL NOT write any of these fields; the Settings section is the only writer.

#### Scenario: A configured default applies

- **WHEN** the row's `config.modelLimits` contains `deepseek/x: 300000` and a session on `deepseek/x` sets no override
- **THEN** 300000 tokens is the effective threshold for that route

#### Scenario: A saved Settings edit reaches the running plugin

- **WHEN** the Settings section changes `modelLimits` or `enabled` while the plugin is loaded
- **THEN** the next pressure check and the next `/autocompact` answer use the new value, without a reload

#### Scenario: A malformed default fails loudly

- **WHEN** `modelLimits` names a key without `/` or a value that is not a positive integer
- **THEN** loading the plugin fails with an error naming the invalid entry

### Requirement: Every accepted threshold is validated against the route's real capacity

A threshold SHALL be a positive safe integer number of tokens. Before the command accepts one, and before the pressure check acts on one derived from a global default, it SHALL be validated against the recent-tail budget the mounted backend keeps verbatim and against the route's real context window: it MUST be greater than the retained tail and strictly less than the context window. The retained tail SHALL be resolved the way the backend's own policy resolves it — an exact `provider/model` policy first, then the backend's published default (`retainTokens`, or a `retainRatio` of the context window minus the reserved completion budget), and the plugin's `retainTokens` fallback only when the backend publishes no usable policy.

#### Scenario: A threshold below the retained tail

- **WHEN** the backend retains 20000 tokens and the user runs `/autocompact 10000`
- **THEN** the command rejects the value and says it must exceed the retained token budget
- **AND** no threshold is stored

#### Scenario: A threshold at or above the context window

- **WHEN** the routed model's context window is 128000 and the user runs `/autocompact 128k`
- **THEN** the command rejects the value and says it must be less than the model context window

#### Scenario: Malformed input

- **WHEN** the user runs `/autocompact soon`, `/autocompact -1`, or `/autocompact 0`
- **THEN** the command answers with the usage line or the positive-integer requirement and stores nothing

### Requirement: The command reports why it cannot work instead of silently doing nothing

When no model route can be resolved, when no compaction backend is mounted for the agent, when the mounted backend does not support `compactRegion`, when the route's context window is unknown, or when the backend's own automatic compaction is disabled (`config.auto === false`), the command SHALL answer with that condition and SHALL NOT store a threshold. The plugin SHALL NOT disable, replace, or reconfigure the backend's own compaction.

#### Scenario: Automatic compaction is disabled by the backend

- **WHEN** the mounted backend publishes `config.auto` `false` and the user runs `/autocompact 300k`
- **THEN** the command refuses, says automatic compaction is disabled by the backend, and stores nothing
- **AND** `/autocompact off` and `/autocompact default` still answer with the current state

#### Scenario: No region-capable backend

- **WHEN** the mounted backend has no `compactRegion` function
- **THEN** the command reports that it requires a backend that supports explicit region compaction
- **AND** the pressure check stays inert for that session

#### Scenario: Unknown context window

- **WHEN** the routed adapter publishes no `contextWindow` for the model
- **THEN** the command reports that no context capacity is known for the route and asks for one to be configured on that adapter model
