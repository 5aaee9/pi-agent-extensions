# Spec Delta

## Purpose

Define the endpoint interrogation that lets `@indexyz/dsh-custom-provider-reasoning-efforts` fill a custom route's reasoning levels without hand-writing them: which routes it probes, what request it sends, what it reads back, how that becomes a declaration, and how the `/reasoning-efforts` command and the load-time pass drive it.

## ADDED Requirements

### Requirement: Discovery probes the profile's own custom routes

Discovery SHALL consider a route a candidate when its profile declares both an explicit, non-empty `models` list and a non-empty `baseURL` — the shape of a hand-written route the installed catalog does not serve. When the row's `discoverRoutes` is non-empty, it SHALL name the probed routes instead of that heuristic. A candidate SHALL be probed once per pass, and only for models the route's own explicit `models` list declares, so a gateway listing hundreds of models cannot produce declarations for models the route does not carry. Discovery SHALL be enabled by the row's `discover` field, which defaults to on; `discover: false` SHALL leave it to the explicit `/reasoning-efforts discover` command.

#### Scenario: A hand-written route is a candidate

- **WHEN** a route declares `baseURL` and a non-empty `models` list
- **THEN** the pass probes that endpoint once and maps the levels it advertises onto the models the route declares

#### Scenario: A catalog route without an explicit model list

- **WHEN** a route declares neither `baseURL` nor a `models` list, relying on the installed catalog
- **THEN** the pass does not probe it

#### Scenario: Discovery is turned off

- **WHEN** the row sets `discover: false` and the load-time pass runs
- **THEN** no endpoint is interrogated and only explicit declarations are applied

### Requirement: The probe follows the Harness's own listing contract

The probe SHALL build the listing URL the shipped discovery uses: `{baseURL}/models` for `openai-completions` and `openai-responses`, and `{baseURL}` without a trailing `/v1` plus `/v1/models?limit=1000` for `anthropic-messages`. It SHALL send `accept: application/json`, the harness attribution headers, and the route's own configured `headers`; `authorization: Bearer <key>` for the OpenAI protocols, and `x-api-key` plus `anthropic-version: 2023-06-01` for Anthropic Messages. The key SHALL come from the route's `apiKeyEnv` through the credentials service, falling back to the process environment, and an unresolvable reference SHALL mean an unauthenticated probe rather than a failure. A protocol whose listing is not readable SHALL be reported as unsupported rather than guessed at. A response that is not successful or not JSON SHALL be reported with the URL and status; an oversized response SHALL be refused.

#### Scenario: An OpenAI-protocol route is probed

- **WHEN** a route's `api` is `openai-responses` with a `baseURL` ending in `/v1`
- **THEN** the probe requests `{baseURL}/models` with a bearer key resolved from its `apiKeyEnv`

#### Scenario: An Anthropic-protocol route is probed

- **WHEN** a route's `api` is `anthropic-messages`
- **THEN** the probe requests the root `/v1/models` with `x-api-key` and the Anthropic API version

#### Scenario: The credential reference is missing

- **WHEN** the route names an `apiKeyEnv` that neither the credential store nor the environment resolves
- **THEN** the probe proceeds unauthenticated and a rejection is reported as an interrogation failure, not as a plugin failure

#### Scenario: The protocol has no readable listing

- **WHEN** a candidate route's `api` is a protocol whose model listing this build does not read
- **THEN** the route is reported as unsupported and nothing is written for it

### Requirement: A Codex-shaped relay's capability manifest is a second source

A relay that proxies a Codex backend may publish an inventory with no reasoning capability at all. The plugin SHALL therefore also consult `GET {root}/backend-api/codex/models` — the route's `baseURL` with a trailing `/v1` removed — for an `openai-responses` route whose own listing described no thinking level for at least one model that route declares. It SHALL read the manifest's `models` array, key each entry by `slug`, take its `supported_reasoning_levels` (string entries or `{effort}` objects), and merge those levels into the route's listing with the listing's own wire spellings taking precedence. A manifest that is absent — `403`, `404`, or a body that is not a manifest — SHALL mean "no manifest" rather than a failure, so a relay without the endpoint stays silent; a manifest that could not be reached, or that answered with any other status, SHALL be reported. The plugin SHALL NOT request a manifest for another protocol, and SHALL NOT request one when the listing already described every declared model.

#### Scenario: A relay whose inventory says nothing

- **WHEN** an `openai-responses` route's `/v1/models` lists its models by id only, and `/backend-api/codex/models` publishes `supported_reasoning_levels` for those slugs
- **THEN** the declared models are written with the manifest's levels, in pi-ai's vocabulary

#### Scenario: A relay without the endpoint

- **WHEN** the manifest request answers `403`, `404`, or a body that is not a manifest
- **THEN** the route is treated as having nothing more to say, and no failure is reported

#### Scenario: A manifest the endpoint failed to serve

- **WHEN** the manifest request cannot be made, or answers with a status other than `403` and `404`
- **THEN** the failure is reported with the URL and the status

#### Scenario: A listing that already describes every declared model

- **WHEN** every declared model already has a level from the route's own listing
- **THEN** no manifest is requested for that route, and another protocol is never asked for one

### Requirement: The advertised levels become a declaration

The probe SHALL read the standard `data` array, or the `models` object some compatible gateways expose, and SHALL read reasoning from `supported_reasoning_levels`, `reasoning_levels`, `supported_reasoning_efforts`, or a `reasoning` object's `efforts` / `supported_efforts`. A level entry MAY be a string or an object carrying `effort`, `level`, `id`, or `name`. A name that is a pi-ai thinking level SHALL map to itself as its wire spelling, with `off` mapped to `null`; a name that is not a thinking level SHALL be ignored. A model that advertises no thinking level, or that declares `reasoning: false`, SHALL produce no declaration and SHALL be left as it is. An explicit row declaration SHALL win over a discovered one for the same route and model.

#### Scenario: The observed gateway's levels

- **WHEN** a model entry carries `reasoning: true` and `supported_reasoning_levels: [{effort: "low"}, {effort: "high"}, {effort: "max"}]`
- **THEN** the discovered declaration is `{low: low, high: high, max: max}`

#### Scenario: Only a boolean capability

- **WHEN** a model entry carries `reasoning: true` and no level list
- **THEN** no declaration is produced for that model and its entry is left untouched

#### Scenario: The gateway names a level the Harness does not know

- **WHEN** a level entry is `turbo`
- **THEN** it is ignored and the remaining known levels still form the declaration

#### Scenario: An explicit declaration disagrees with the endpoint

- **WHEN** the row declares a route/model and the endpoint advertises a different set
- **THEN** the row's declaration is the one written

### Requirement: The `/reasoning-efforts` command drives the passes and reports their outcome

The host half SHALL register a command named `reasoning-efforts`, identified as `@indexyz/dsh-custom-provider-reasoning-efforts`, with the hint `status | apply | discover | clear`. `status` (also the bare command) SHALL plan without writing and report the pending changes and the skips; `apply` SHALL write the row's explicit declarations; `discover` SHALL probe the candidate routes and write the explicit and discovered declarations; `clear` SHALL remove the `reasoningEfforts` the declarations name. Every mode SHALL report what changed (naming the route, model, and levels), what was already current, and what was skipped with its reason. An unrecognized argument SHALL answer with the usage line and write nothing. `status`, `apply`, and `clear` SHALL perform no network request.

#### Scenario: Status writes nothing

- **WHEN** the user runs `/reasoning-efforts` while declarations are pending
- **THEN** the answer lists the pending pairs and the configuration is unchanged

#### Scenario: Apply writes the declarations

- **WHEN** the user runs `/reasoning-efforts apply`
- **THEN** every declared pair that the profile carries gains its `reasoningEfforts` and the answer names the levels applied

#### Scenario: Discover probes and writes

- **WHEN** the user runs `/reasoning-efforts discover`
- **THEN** the candidate routes are interrogated, the levels they advertise are written, and a route that failed is reported

#### Scenario: An unknown argument

- **WHEN** the user runs `/reasoning-efforts soon`
- **THEN** the answer is the usage line and nothing is written

### Requirement: The load-time pass cannot fail or delay startup

When `applyOnLoad` is on, the plugin SHALL run the pass after startup: through the launcher's `appReady.onReady()` when the composition provides it, and otherwise with a bounded retry that stops at the first pass whose namespace is reachable, because the Loader mounts a profile's entries concurrently. The pass SHALL run asynchronously, SHALL contain every failure to a log message, and MUST NOT throw out of the plugin's load, delay it, or block on a network request. `applyOnLoad: false` SHALL leave the command as the only writer.

#### Scenario: The pass runs after a successful startup

- **WHEN** the composition provides the launcher's readiness signal
- **THEN** the pass is registered with it and runs only after startup commits

#### Scenario: A namespace is not mounted yet

- **WHEN** no readiness signal is provided and the target namespace's entry is still mounting at the first attempt
- **THEN** the pass retries within its bounded budget and applies once the namespace is reachable

#### Scenario: A gateway is unreachable at boot

- **WHEN** a probe fails during the load-time pass
- **THEN** the failure is logged, the plugin stays loaded, startup is unaffected, and the declarations that did not need the network are still applied

#### Scenario: `applyOnLoad` is off

- **WHEN** the row sets `applyOnLoad: false`
- **THEN** nothing is written at load and the command is the only writer

#### Scenario: No settings service

- **WHEN** the composition mounts no `settings` service
- **THEN** the load-time pass does not run and the command answers that the configuration cannot be reached
