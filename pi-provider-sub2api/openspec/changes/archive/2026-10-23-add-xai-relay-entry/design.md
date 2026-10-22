# Design

## Context

See `proposal.md` for motivation. The design follows Sub2API’s Grok channel and Pi’s xAI Responses behavior.

Source references:

- Sub2API `dba770d56`, `/Volumes/Git/sub2api`: `backend/internal/handler/gateway_handler.go` publishes Grok inventory and effort metadata; `backend/internal/pkg/xai/models.go` classifies text/media IDs; `backend/internal/service/openai_gateway_grok.go` handles upstream mappings and request normalization; `openai_gateway_grok_cache.go` defines request-level mixed-tool cache routing.
- Pi 1.4.0: the installed published host packages provide the API/types and bundled xAI catalog. Source cross-checks use `/tmp/repos/earendil-works/pi` at `8c03fef` (package manifests declare 1.4.0), especially `packages/ai/src/api/openai-responses.ts`, `openai-responses-shared.ts`, `models.ts`, `compat.ts`, and `test/xai-responses.test.ts`. Installed `@earendil-works/pi-ai@1.4.0` catalog data confirms Grok 4.6/4.7 metadata.
- The plugin already has per-entry credentials and accounting. Its metadata restoration needs to retain xAI modalities, reasoning, and thinking mappings in addition to limits and costs.

External checkout paths are audit references, not runtime dependencies.

## Goals / Non-Goals

**Goals:** Implement a small, provider-scoped xAI path with source-backed model metadata and a complete local-function-tool conversation through Pi’s existing Responses adapter.

**Non-Goals:** Upstream account management, server-side model mapping, a new transport/parser, native hosted tools, search endpoints, citations, or a search plugin.

## Decisions

Pi 1.4.0 is the minimum supported host and the exact development/acceptance baseline for this package. During implementation, pin `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` devDependencies to `1.4.0`, retain `"*"` host peers, and refresh the npm lockfile. Update the README requirement and this package’s reference-table row; leave other packages’ pins unchanged. Do not add support paths for earlier hosts.

### 1. Entry and authentication

```json
{
  "zero-aicoding-xai": {
    "baseURL": "https://relay.example/v1",
    "token": "${SUB2API_GROK_TOKEN}",
    "api": "xai"
  }
}
```

`xai` is the configuration selector; `openai-responses` is the Pi API. Keeping these distinct lets entry capabilities be selected directly without another configuration field. The entry key remains the provider ID, following the existing named-registration behavior, including explicit same-name registrations. The extension does not rename entries.

Reuse URL normalization and literal/environment/command-token resolution. Discovery, generation, billing, and quota use the owning entry’s endpoint and token. Same-host entries retain separate accounting and failure state. Authentication failures are reported with no alternate credential or endpoint retry.

### 2. Chat inventory and model metadata

Use `/v1/models` as the sole inventory. Keep validated model IDs unchanged, sanitize names, and retain valid unfamiliar text aliases. Catalogs enrich inventory items; they do not create additional models. Discovery failure leaves that entry empty and other entries operational.

Apply Sub2API’s `IsGrokImagineModel` classification: exclude `imagine*`, `grok-imagine`, `grok-imagine-1`, `grok-imagine-edit`, `grok-video-1.5`, `grok-imagine-image*`, and `grok-imagine-video*`. For classification only, trim/lowercase and strip one `xai/`, `x-ai/`, or `grok/` prefix. The inventory `type: "model"` alone does not distinguish media from chat.

Resolve metadata field by field using exact-ID xAI catalog matches:

| Field                 | Precedence                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Context/output limits | Valid remote aliases, cached xAI field, bundled xAI field, default                                                               |
| Input modalities      | Usable remote `input_modalities` (text/image), cached xAI input, bundled xAI input, text-only                                    |
| Prices                | Cached xAI cost, bundled xAI cost, zero estimates; scale rates and tiers by the entry billing multiplier                         |
| Reasoning capability  | True `supportsReasoningEffort` or recognized positive remote effort evidence, cached xAI reasoning, bundled xAI reasoning, false |
| Configurable effort   | Remote false flag veto, authoritative remote list, valid cached xAI mapping, valid bundled xAI mapping, none                     |

Keep existing valid remote limit aliases and try later aliases when an earlier value is invalid. Output limits must fit the resolved context window. Preserve explicit false values and empty bounds; missing fields alone fall through. Defaults are 200000 context and `min(16384, context)` output for every unknown xAI ID, independent of its spelling. Restore host catalogs offline; no network refresh or duplicated local model table is needed.

Pi 1.4.0’s bundled catalog includes `grok-4.6` and `grok-4.7` with text/image input, 500000 context/output limits, reasoning mappings, and token prices with tiers. With no usable remote or cached value, use that bundled metadata rather than generic defaults. Verify the installed 1.4.0 catalog through registration tests instead of duplicating these values in a local model table. Defaults apply only to fields still unavailable after the full lookup chain, such as unfamiliar relay aliases; document their reduced limits, unavailable image input, and zero-price estimates as metadata limitations, not verified capacity or free service.

### 3. Reasoning capability and effort controls

Read `reasoningEfforts[].value` first. If that field is absent or not an array, accept `supported_reasoning_levels` or `supportedReasoningLevels` using string or effort-object entries. Trim/lowercase and deduplicate recognized values. Any array, including an empty or all-unknown array, is an authoritative bound. Malformed entries do not invalidate the model. `supportsReasoningEffort: false` disables effort selection even when a list disagrees.

Recognized wire efforts are `none`, `low`, `medium`, `high`, and `xhigh`. Map explicit `none` to Pi `off`; expose other values at their matching UI levels. Mark unsupported levels null so Pi’s defaults cannot enable them. Catalog mappings use the same wire-value rules; do not synthesize extra UI alias levels.

Reasoning capability is separate from effort selection. A false effort flag or an empty list preserves otherwise known reasoning support. A true flag without a list establishes reasoning but does not invent effort choices. For a reasoning model without configurable effort, leave the `off` mapping unset (non-null) and set every other UI level to null, so Pi exposes only `off` as the no-client-override state. The wrapper must delete the adapter-generated `reasoning` field during payload normalization before sending, while retaining encrypted reasoning. This UI-only `off` state does not advertise support for the wire effort `none`. Document that this `off` leaves backend reasoning at its default. Remote `reasoningEffort` and list default markers are descriptive, not overrides of the session choice. Pi’s normal clamping handles model switches.

### 4. Responses requests and replay

Use `openAIResponsesApi().streamSimple` from `@earendil-works/pi-ai/compat`, the public host export available to the extension loader. A thin wrapper composes the caller’s `onPayload`, then normalizes the payload for the actual request model. Forward Pi 1.4.0’s transcript context unchanged and preserve cancellation, caller fetch, response hooks, and stream/error behavior. If the host export is unavailable, report an unsupported-host error for xAI entries while leaving other entries operational; an unwrapped fallback would not meet the contract.

Send `POST /v1/responses` with the entry bearer token and `store: false`. For reasoning models, merge `reasoning.encrypted_content` into `include` without losing unrelated values or adding duplicates. Send only a supported effort, or omit the reasoning control when there is no configurable effort. Keep the configured provider/model identity through local function calls, results, and encrypted replay.

Set `supportsLongCacheRetention: false`, matching Pi’s xAI Responses policy. Environment or request-level long retention must not emit `prompt_cache_retention: "24h"`. Use a request-scoped fetch wrapper to reject redirects and enforce the tool-routing header below after caller headers are merged. Do not patch global transports.

Reusing the host serializer/parser keeps this path small and retains Pi’s existing function-tool and reasoning replay support. A custom parser is unnecessary for the scoped feature.

### 5. Local tools and Grok cache routing

Ordinary Pi function tools are supported. Reject non-empty `serverTools` on an xAI entry; omitted or empty groups are valid. The separate search plugin remains independent of this work.

Known Free OAuth accounts default to Sub2API’s mixed native/client-tool cache route, which can add native searches or convert client functions named `web_search`/`x_search`. Send `X-Sub2API-Grok-Client-Tool-Cache: off` on generation requests, enforcing it even against caller opt-in. This keeps those functions local at the cost of losing the Free-account mixed-tools cache route, potentially increasing prompt costs. Server-added definitions with `tool_choice: none` do not execute searches.

Pi does not retain native search items and citations as complete tool history, so hosted-tool support is not implied. Verify the actual function-tool stream against the deployed server; unexpected native execution/events are an acceptance blocker, not a reason to add a parser to this change.

### 6. Pi integration contract

The xAI entry exposes its discovered effort controls, provider-local usage, and ordinary Pi textual compaction. Its behavior is selected by entry type and remains the same for any relay model alias. Other entry types keep their existing behavior.

The following are the complete integration limits for this entry:

| Surface                                   | xAI behavior                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `compress_model`, `compress_service_tier` | Accept omitted/null; reject non-null values with a field-specific error                              |
| `requestModes`, `modelRequestModes`       | Preserve valid stored values but keep them inactive; see `specs/request-mode-persistence/spec.md`    |
| `/toggle-ultra`, `/openai-compress`       | Reject the selected xAI entry without changing state or sending a request                            |
| Footer                                    | Show the selected entry’s usage and supported state; hide inactive request-mode and ultra indicators |
| `/compact`                                | Use Pi’s ordinary textual summarization through the xAI model                                        |

Keep these checks at existing configuration/command/registration boundaries. Do not build a new capability framework.

## Risks / Trade-offs

- [Partial or conflicting metadata] -> Remote effort bounds win; exact-ID catalog fields fill missing data. Sub2API uses omitted fields for some supported models, such as `grok-4.3` and `grok-4.20-0309-reasoning`; absence is not an explicit false flag. Document unresolved capabilities instead of guessing from names.
- [No dedicated Pi label for default backend reasoning] -> Document the no-override meaning of `off` on models without configurable effort.
- [Cache-route opt-out costs and server-version variation] -> Explain the cost trade-off and require a real local-tool round trip before claiming compatibility.
- [Host version drift] -> Implement and smoke-test against exactly Pi 1.4.0; loading on a newer installed host is an additional check, not a replacement for the baseline.

## Migration Plan

The implementation upgrades the package’s host development pins to 1.4.0 and adds the selector, configuration examples, and package documentation. Users must upgrade Pi to at least 1.4.0 before using that release. Record a release intent that accounts for this raised minimum; do not edit the extension’s version manually. Users opt in through their own entry configuration; credentials are never migrated automatically. Removing the entry reverses that opt-in. Tests, root checks, pinned-host loading, and real Grok-session acceptance are listed in `tasks.md`; archive follows implementation and verification.
