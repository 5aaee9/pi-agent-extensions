# Spec Delta

## Purpose

Define the declaration model `@indexyz/dsh-custom-provider-reasoning-efforts` supplies to a hand-written `llm-pi-ai` provider route: what a declaration carries, which levels are accepted, how a declaration is validated, how it is planned against the profile's own configuration, and how it is written so the resolution chain sees it.

## ADDED Requirements

### Requirement: A declaration names a route, a model, and the levels it offers

The plugin's row configuration SHALL carry `providers`, a table keyed first by `llm-pi-ai` route and then by exact model id, whose value is either a dict of pi-ai thinking levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) mapped to the wire spelling that level dispatches, or `false` for a model the route serves but that cannot reason. A level's wire value MAY be `null` for `off` only, meaning dispatch sends nothing; every other level SHALL carry a non-empty string. An entry SHALL be rejected when it is empty, offers no level other than `off`, carries `null` or an empty string on a level that is not `off`, or carries a key that is not a pi-ai thinking level, and the rejection SHALL name the route, the model, and the level at fault. Validation SHALL run while the plugin loads, so a malformed declaration fails the load rather than a later write.

#### Scenario: The observed gateway is declared

- **WHEN** `providers.magpie["ollama-cloud/deepseek-v4.1-flash"]` is `{low: low, high: high, max: max}`
- **THEN** the declaration is accepted and offers exactly those three levels

#### Scenario: A non-reasoning model is declared off

- **WHEN** a model's declaration is `false`
- **THEN** the plugin records that the route serves it without reasoning, and the model's `reasoningEfforts` is written as `false`

#### Scenario: A level with no wire spelling

- **WHEN** a declaration offers `high: null`
- **THEN** the load fails with an error naming the route, the model, and `high`

#### Scenario: An empty or off-only declaration

- **WHEN** a declaration is `{}` or `{off: null}`
- **THEN** the load fails with an error saying the declaration offers no thinking level

#### Scenario: An unknown level key

- **WHEN** a declaration offers `ultra: ultra`
- **THEN** the load fails with an error naming `ultra` as no pi-ai thinking level

### Requirement: Only models the profile already declares are written

The plugin SHALL resolve the configuration namespace's descriptor through the `settings` service, SHALL read the profile patch's own raw `providers` value from that descriptor, and SHALL write a declaration only for a route the profile declares and a model that route's explicit `models` list contains. A declared route the profile does not carry, a route without an explicit `models` list, and a declared model the route does not list SHALL each be skipped with a reason instead of being created or guessed. The plugin MUST NOT invent a `baseURL`, an `api`, a credential reference, or a model entry.

#### Scenario: A declared model is filled

- **WHEN** the profile declares route `magpie` with model `ollama-cloud/kimi-k3` and the declaration names that pair
- **THEN** the model entry gains its `reasoningEfforts` and every other field of the entry and the profile is left as it was

#### Scenario: The route is not in the profile

- **WHEN** a declaration names a route the profile does not declare
- **THEN** the result reports the route as skipped with the reason that it is not declared in the profile, and the configuration is unchanged

#### Scenario: The model is not on the route

- **WHEN** a declaration names a model the route's explicit `models` list does not contain
- **THEN** the result reports that pair as skipped and the configuration is unchanged

### Requirement: The write goes through the settings service and is idempotent

The plugin SHALL write with the namespace's `update()` call, passing the complete `providers` value it planned and the revision `describe()` returned, and SHALL NOT edit any profile file directly. When the plan reports no change the plugin SHALL NOT call `update()` at all, so a second load leaves the file untouched. A revision conflict SHALL be retried once against a freshly read descriptor; a write the Loader rejects SHALL be reported as a failure with its message, not swallowed.

#### Scenario: A pending declaration is applied

- **WHEN** the plan reports one change for the `llm-pi-ai` namespace
- **THEN** the plugin calls `settings.update("llm-pi-ai", {providers: <planned>}, <revision>)` exactly once

#### Scenario: Nothing to change

- **WHEN** every declared model already carries the declared effort, or there is no declaration at all
- **THEN** the plugin writes nothing and reports the state as unchanged

#### Scenario: The revision moved

- **WHEN** `update()` rejects with a settings conflict
- **THEN** the plugin re-reads the descriptor and retries the write once

#### Scenario: The namespace is absent

- **WHEN** no configurable namespace with the configured id is mounted
- **THEN** the plugin reports that it cannot reach the configuration and writes nothing

### Requirement: A declared non-reasoning model is written as `false`

When a declaration is `false`, the plugin SHALL write `reasoningEfforts: false`, which is the field's own spelling for "this model cannot reason" and is the same shape `llm-pi-ai` accepts from a profile author. The plugin SHALL NOT delete the field instead, because an absent field means "inherit the installed catalog", which a hand-written route cannot do.

#### Scenario: A model the catalog does not describe

- **WHEN** a route's model is declared `false`
- **THEN** the entry carries `reasoningEfforts: false` and resolves to no selectable levels

### Requirement: `/reasoning-efforts clear` removes only what the declarations name

`clear` SHALL delete the `reasoningEfforts` field from exactly the route/model pairs the plugin's own `providers` table names, leaving other models' declarations untouched. It SHALL report the same applied/unchanged/skipped result the other modes report.

#### Scenario: Clearing a declared pair

- **WHEN** a declared pair's entry carries `reasoningEfforts` and the user runs `/reasoning-efforts clear`
- **THEN** that field is removed and every other model's declaration stays

#### Scenario: Clearing a pair with nothing to remove

- **WHEN** a declared pair's entry carries no `reasoningEfforts`
- **THEN** the result reports it as unchanged
