# xai-relay Specification

## Purpose

Connect a Sub2API Grok group through a separately authenticated xAI entry with discoverable chat capabilities, accurate reasoning controls, and working Responses conversations with local Pi tools.

## Requirements

### Requirement: Supported Pi baseline

The package SHALL require Pi 1.4.0 or newer and SHALL use exactly Pi 1.4.0 for baseline implementation and acceptance. Earlier Pi versions SHALL be outside the support contract. User-facing requirements SHALL state this minimum.

#### Scenario: Baseline acceptance

- **WHEN** the feature is verified for release
- **THEN** host loading and the xAI conversation checks run on Pi 1.4.0
- **AND** checks on newer hosts do not replace that baseline

### Requirement: Explicit xAI entry

The extension SHALL accept `api: "xai"` in a named `sub2api.json` entry with its own `baseURL` and `token`. The configured name SHALL remain the Pi provider identity and chat models SHALL use `openai-responses`. Existing named-registration, URL normalization, and literal/environment/command-token rules SHALL apply.

#### Scenario: Named Grok entry

- **WHEN** `zero-aicoding-xai` has a valid Grok-group token, endpoint, and `api: "xai"`
- **THEN** its discovered models appear under that provider name and use the Responses API

#### Scenario: Invalid configuration or unavailable host support

- **WHEN** a required field is invalid or a credential expression cannot be resolved
- **THEN** loading reports the provider and field without exposing credentials
- **WHEN** the required xAI host adapter is unavailable
- **THEN** the xAI entry reports an unsupported-host error without a reduced-behavior fallback, while other entries remain operational

### Requirement: Entry-local authentication and accounting

Discovery, generation, billing, and quota SHALL use the owning xAI entry’s endpoint and resolved token. Prices and usage state SHALL remain entry-local. Authentication failures SHALL be surfaced without retrying another credential or endpoint.

#### Scenario: Same host with separate keys

- **WHEN** two entries share a host and model ID but use different tokens and billing multipliers
- **THEN** requests, scaled prices, usage state, and authentication failures remain attributable to the owning entry

### Requirement: Authoritative chat inventory

An xAI entry SHALL use `GET /v1/models` as its only remote inventory and SHALL reuse a matching discovery cache until `/sub2api-refresh`. Registered IDs SHALL stay unchanged. Only chat models from that inventory or cache SHALL be registered; Pi catalogs SHALL supply metadata, not models. A failed discovery with no cache SHALL write nothing. A failed refresh SHALL keep the last cache.

#### Scenario: Unfamiliar text alias

- **WHEN** the inventory advertises a valid unfamiliar text alias
- **THEN** it remains selectable with its exact ID and the xAI entry behavior

#### Scenario: Missing inventory

- **WHEN** no matching discovery cache exists and the inventory request fails, returns malformed data, or contains no valid IDs
- **THEN** that entry registers no discovered models, reports a failure when appropriate, and does not substitute local catalog models

#### Scenario: Cached inventory

- **WHEN** a previous successful inventory is cached for the same xAI entry
- **THEN** startup registers those models without calling `GET /v1/models`
- **AND** `/sub2api-refresh` fetches the inventory again
- **AND** a failed refresh keeps the cached models

### Requirement: Media model classification

Known Grok image/video generators SHALL be excluded from chat discovery. Classification SHALL recognize the server’s known media names and optional `xai/`, `x-ai/`, or `grok/` prefixes, case-insensitively. Classification normalization SHALL NOT rewrite registered text IDs or exclude unfamiliar text aliases merely for lacking a Grok prefix.

#### Scenario: Mixed inventory

- **WHEN** the inventory contains `grok-4.6` alongside `imagine*`, `grok-imagine`, `grok-imagine-1`, `grok-imagine-edit`, `grok-video-1.5`, `grok-imagine-image*`, and `grok-imagine-video*` families, including prefixed variants
- **THEN** the known media entries are excluded and the text model remains selectable

### Requirement: xAI metadata resolution

Valid remote limits and modalities SHALL take precedence over exact-ID cached xAI metadata, then bundled xAI metadata, then defaults. Missing fields SHALL resolve independently. Prices SHALL use cached then bundled xAI catalog rates scaled by the entry multiplier, including tiers. Defaults SHALL be 200000 context, at most 16384 output tokens, text-only input, and zero estimated prices. Output limits SHALL be positive and fit the resolved context.

#### Scenario: Partial metadata

- **WHEN** the inventory supplies context, the cached xAI entry supplies only output limits and prices, and bundled metadata supplies modalities
- **THEN** each field uses its highest-precedence valid value
- **AND** invalid limit aliases are skipped in favor of later valid aliases or lower-precedence values

#### Scenario: Bundled Grok capabilities

- **WHEN** the relay advertises `grok-4.6` or `grok-4.7` without limits/modalities and no usable cached values exist
- **THEN** the registered model uses the Pi 1.4.0 bundled xAI limits, text/image input, and catalog rates for fields not supplied remotely
- **AND** generic metadata defaults do not replace available bundled fields

#### Scenario: Model absent from catalogs

- **WHEN** an unfamiliar model or alias has no usable limits/modalities metadata
- **THEN** it uses the documented defaults, with output capped at `min(16384, context)` regardless of ID spelling
- **AND** documentation explains that defaults can reduce usable limits and image support, and zero estimates do not mean free service

### Requirement: Reasoning capability discovery

The extension SHALL distinguish reasoning capability from configurable effort. A true `supportsReasoningEffort` or recognized positive remote effort evidence SHALL establish reasoning support; otherwise exact-ID cached then bundled xAI reasoning metadata SHALL apply. A false effort flag SHALL disable effort selection while preserving otherwise known reasoning support. Missing reasoning evidence SHALL default to false.

#### Scenario: Reasoning without effort selection

- **WHEN** a model is known to reason but `supportsReasoningEffort` is false or no usable effort bound exists
- **THEN** reasoning and encrypted replay remain enabled, the request omits the reasoning control, and Pi exposes only `off`
- **AND** that `off` is documented as leaving backend reasoning at its default, not disabling it

### Requirement: Bounded effort choices

`reasoningEfforts[].value` SHALL bound effort choices after normalization and deduplication. Recognized wire values SHALL be `none`, `low`, `medium`, `high`, and `xhigh`; explicit `none` SHALL map to Pi `off`. An empty or all-unknown array SHALL mean no configurable effort. A false effort flag SHALL veto a conflicting list. Missing lists SHALL use valid xAI catalog mappings without inventing UI levels.

#### Scenario: Published effort list

- **WHEN** a Grok model advertises low, medium, high, and xhigh
- **THEN** exactly those levels are selectable, with unsupported Pi levels disabled
- **AND** remote default markers do not override the user’s session choice

#### Scenario: Fallback fields and malformed values

- **WHEN** `reasoningEfforts` is absent or not an array
- **THEN** a valid `supported_reasoning_levels` or `supportedReasoningLevels` list is used before catalog mappings
- **AND** string and effort-object entries are normalized, while malformed entries do not discard the model

#### Scenario: Explicit empty bound

- **WHEN** `reasoningEfforts` is empty or contains only unknown values
- **THEN** no catalog or secondary list restores effort choices

#### Scenario: Positive flag without choices

- **WHEN** `supportsReasoningEffort` is true but no usable remote list or catalog mapping exists
- **THEN** reasoning is enabled without guessed effort choices

### Requirement: xAI Responses generation

Generation SHALL use `POST /v1/responses`, the entry bearer token, and `store: false`. Reasoning models SHALL merge `reasoning.encrypted_content` into `include`. Effort SHALL be omitted or a resolved supported wire value. Requests SHALL reject redirects and preserve caller callbacks, cancellation, response hooks, and fetch behavior. Long cache retention SHALL be disabled.

#### Scenario: Named entry with encrypted reasoning

- **WHEN** a reasoning model under `zero-aicoding-xai` generates a response
- **THEN** `include` contains encrypted reasoning without duplicates or loss of unrelated values
- **AND** the provider name and relay model ID stay unchanged

#### Scenario: Long retention requested

- **WHEN** environment or request options select long cache retention
- **THEN** the request omits `prompt_cache_retention: "24h"` without relying on server removal

### Requirement: Local function tools and replay

Ordinary Pi function tools SHALL remain usable through xAI generation. Subsequent turns SHALL preserve function calls, tool results, and returned encrypted reasoning under the same entry identity. Native hosted tools and search endpoints SHALL remain outside this entry contract; non-empty `serverTools` SHALL fail configuration while omitted or empty groups SHALL be accepted.

#### Scenario: Function-tool continuation

- **WHEN** a Grok model calls a registered local tool and Pi supplies its result
- **THEN** the conversation continues through the same xAI entry with tool history and encrypted reasoning replay intact

#### Scenario: Hosted tools configured

- **WHEN** an xAI entry specifies non-empty `serverTools`
- **THEN** loading explains that hosted tools are outside this entry contract
- **AND** this change registers no search tools and calls no search endpoints

### Requirement: Grok mixed-tool routing opt-out

Every xAI generation request SHALL send `X-Sub2API-Grok-Client-Tool-Cache: off` after caller header merging. Ordinary client functions named `web_search` or `x_search` SHALL remain local functions rather than opting into native conversion. Documentation SHALL explain the Free-account mixed-tools cache-route loss and potential prompt-cost increase.

#### Scenario: Caller requests cache-route opt-in

- **WHEN** caller headers request opt-in and the request contains local functions
- **THEN** the outgoing opt-out remains off and the function definitions retain their local-tool identity

### Requirement: xAI session behavior

The xAI entry SHALL support Pi’s ordinary textual compaction through its selected model. Omitted/null `compress_model` and `compress_service_tier` SHALL be accepted and non-null values rejected. `/toggle-ultra` and `/openai-compress` SHALL reject an xAI selection without state changes or generation requests. The footer SHALL show entry-local usage and no inactive ultra indicator.

#### Scenario: Session switches to xAI

- **WHEN** the user switches from another provider with temporary settings to an xAI model
- **THEN** xAI retains its discovered effort controls and entry-local usage
- **AND** `/compact` uses ordinary textual summarization while unsupported commands leave all provider preferences unchanged
