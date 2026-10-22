# @indexyz/pi-provider-sub2api

A [pi](https://github.com/earendil-works/pi-mono) provider extension for Sub2API-compatible relays. It discovers models dynamically, registers every configured relay as a separate pi provider, and reports relay quota usage in pi.

## Requirements

- Pi 1.4.0 or newer
- Node.js 22.19 or newer
- A Sub2API-compatible relay exposing `GET /backend-api/codex/models` for explicitly configured Codex providers, or `GET /v1/models` for other providers (including [xAI entries](#xai-grok-entries)), plus at least one supported generation endpoint

## Install

```bash
pi install npm:@indexyz/pi-provider-sub2api
```

Releases are published to npm as `@indexyz/pi-provider-sub2api`; each release is tagged `@indexyz/pi-provider-sub2api@<version>`.

To try the extension from this repository without installing it (after `npm install` at the repository root):

```bash
pi -e ./pi-provider-sub2api/index.ts
```

## Configure

Create `~/.pi/agent/sub2api.json`:

```json
{
  "my-relay": {
    "baseURL": "https://relay.example.com",
    "token": "replace-with-your-token",
    "api": "anthropic-messages",
    "serverTools": {
      "anthropic": [
        {
          "type": "web_search_20260209",
          "name": "web_search"
        }
      ]
    }
  },
  "another-relay": {
    "baseURL": "https://another.example.com/v1",
    "token": "replace-with-another-token",
    "api": "openai-codex-responses",
    "compress_service_tier": "fast",
    "serverTools": {
      "responses": [{ "type": "web_search" }]
    }
  },
  "responses-relay": {
    "baseURL": "https://responses.example.com/v1",
    "token": "replace-with-token",
    "api": "openai-responses"
  },
  "completions-relay": {
    "baseURL": "https://completions.example.com/v1",
    "token": "replace-with-token",
    "api": "openai-completions"
  }
}
```

Each top-level key becomes the provider name shown by pi. `baseURL` may include the `/v1` suffix; the extension normalizes both forms. The optional `api` setting accepts `anthropic-messages`, `openai-codex-responses`, `openai-responses`, `openai-completions`, or `xai`. When present, it is applied to every discovered model for that provider instead of inferring an API from model IDs; `xai` selects a [Grok entry](#xai-grok-entries).

A `token` may reference an environment variable instead of a literal secret, keeping the key out of the file:

```json
{
  "my-relay": {
    "baseURL": "https://relay.example.com",
    "token": "${SUB2API_TOKEN}",
    "api": "openai-responses"
  }
}
```

When `token` is exactly `${ENV_VAR_NAME}`, the extension reads the secret from that environment variable when pi starts. The variable must be set to a non-empty value, otherwise loading fails with an error naming the missing variable.

A leading `!` executes a shell command and uses its trimmed standard output as the token:

```json
{
  "my-relay": {
    "baseURL": "https://relay.example.com",
    "token": "!/home/you/bin/get-api-key",
    "api": "openai-responses"
  }
}
```

The command runs once per configuration load (startup or `/reload`). The resolved token is reused for model discovery, billing/quota, chat, and Codex compaction; it is not written back to the configuration. Reload after a short-lived token expires. Commands run with Pi's permissions and environment through the system shell, so only use trusted, non-interactive commands, preferably with absolute paths.

Commands have a 10-second timeout and a 64 KiB output limit. Standard output must contain only the key; surrounding whitespace is trimmed. Empty output, embedded control characters, nonzero exit, or timeout fail configuration loading, without logging the command or its output. To configure a literal token starting with `!`, use `$!` instead. Environment values and command output are never evaluated again as expressions; other literal tokens retain their existing behavior.

The configuration directory follows `PI_CODING_AGENT_DIR` when that environment variable is set. Otherwise it defaults to `~/.pi/agent`.

Restart pi after creating the file, or run `/reload` in an interactive session. Then use `/model` to select a discovered model under the configured provider.

### xAI (Grok) entries

Sub2API Grok groups need their own API key. Add a separate entry with `"api": "xai"` for that key:

```json
{
  "zero-aicoding-xai": {
    "baseURL": "https://relay.example.com/v1",
    "token": "${SUB2API_GROK_TOKEN}",
    "api": "xai"
  }
}
```

The entry key (`zero-aicoding-xai` here) is the Pi provider ID: models appear as `zero-aicoding-xai/<model>` in `/model`, and the extension never renames it. `xai` only selects this entry type; its models use Pi's `openai-responses` API and call `POST <baseURL>/v1/responses`. `baseURL` is normalized like any other entry, so `https://relay.example.com` and `https://relay.example.com/v1` are equivalent. The token accepts the same literal, `${ENV_VAR}`, and `!command` forms, for example `"token": "!/home/you/bin/get-grok-key"`. Discovery, generation, billing, and quota use only this entry's endpoint and token, so two entries on the same host with different keys keep separate prices, usage, and failures; an authentication failure is reported for its entry and never retried with another credential.

An xAI entry rejects settings that do not apply to it, naming the provider and field:

- `compress_model` and `compress_service_tier` must be omitted or `null`.
- `serverTools` may be omitted or contain only empty groups; hosted tools are outside this entry type.
- `requestModes` and `modelRequestModes` are validated and kept in the file, but stay inactive for every model of the entry.

xAI entries require Pi 1.4.0 or newer. On a host without Pi's public OpenAI Responses adapter, xAI entries are disabled with an error on stderr while other entries keep working.

#### Models and metadata

`GET /v1/models` is the only inventory; the Codex manifest is never consulted. Every valid ID is registered unchanged, including aliases such as `grok-latest`, `xai/grok-4.7`, or mapping keys like `gpt-*`, except Grok image and video generators: IDs equal to `grok-imagine`, `grok-imagine-1`, `grok-imagine-edit`, or `grok-video-1.5`, or starting with `imagine`, `grok-imagine-image`, or `grok-imagine-video`, compared case-insensitively after removing one `xai/`, `x-ai/`, or `grok/` prefix. A failed, malformed, or empty inventory leaves that entry without models (logged as `[sub2api:<provider>] failed to fetch models`) and never substitutes catalog models.

Each field resolves on its own. Pi's xAI catalogs match the exact registered ID only: the locally cached catalog (`models-store.json`, restored offline) first, then the catalog bundled with Pi.

| Field              | Source, first available wins                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Context window     | Remote limit aliases, cached catalog, bundled catalog, 200,000                                                                 |
| Output limit       | Remote aliases, cached, bundled, then `min(16384, context window)`; a value larger than the resolved context window is skipped |
| Input              | Remote `input_modalities` (`text`/`image`), cached, bundled, text only                                                         |
| Prices             | Cached, bundled, zero; scaled by the entry's billing multiplier, including long-context tiers                                  |
| Reasoning          | `supportsReasoningEffort: true` or a remote effort other than `none`, cached, bundled, no reasoning                            |
| Selectable efforts | None when `supportsReasoningEffort` is `false`; otherwise the remote list, then the cached or bundled thinking map, then none  |

Remote limit aliases are the ones listed under [Quota reporting](#quota-reporting); an invalid alias falls through to the next one. The remote effort list is read from `reasoningEfforts[].value`; when that field is missing or not an array, from `supported_reasoning_levels` or `supportedReasoningLevels` (strings or `{ "effort": ... }` objects). Values are trimmed, lowercased, and deduplicated; `none`, `low`, `medium`, `high`, and `xhigh` are recognized and anything else is ignored. A present list is authoritative even when empty or unrecognized; so is a cached or bundled thinking map, which leaves only `off` when it enables no effort. Pi exposes exactly the matching levels; `none` becomes Pi's `off`, and `minimal` and `max` are never offered. The relay's `reasoningEffort` and `default` markers are informational; Pi keeps your session's level and clamps it as usual when you switch models.

With Pi 1.4.0, `grok-4.6` and `grok-4.7` advertised without limits get the bundled 500,000-token context and output limits, text and image input, and catalog prices. For IDs absent from both catalogs, including prefixed or differently cased spellings of known models, fields the relay does not supply fall back to 200,000/16,384 tokens, text-only input, and zero estimated prices. These are conservative estimates, not the service's capacity: they can cap long sessions and hide image input, and a zero price means "unknown", not free. Reasoning support the relay does not advertise is not guessed from names, so a model such as `grok-4.20-0309-reasoning` without metadata is registered without reasoning controls or encrypted-reasoning replay.

A model that reasons but has no selectable effort (for example `supportsReasoningEffort: false` on `grok-4.7`, or `true` without a list on an unknown ID) shows only `off`. For these models `off` means "no override": the request omits `reasoning` and the backend reasons at its default level. It does not disable reasoning.

#### Requests and session behavior

Requests go through Pi's own Responses adapter, so streaming, tool calls, cancellation, response hooks, and retries behave as for Pi's built-in xAI provider. After other extensions' payload hooks run, the extension ensures `store: false`, adds `reasoning.encrypted_content` to `include` for reasoning models (keeping other values), and sends `reasoning.effort` only when it is one of the model's selectable efforts. Encrypted reasoning, local function calls, and their results replay on later turns of the same entry and model. Long prompt-cache retention is disabled: `PI_CACHE_RETENTION=long` or a request for long retention never sends `prompt_cache_retention: "24h"`. Redirects are rejected.

Pi's ordinary function tools work, including local tools named `web_search` or `x_search`. Sub2API routes known Grok Free OAuth accounts that send client tools through a mixed native/client-tool cache route, which can add native searches or turn those functions into native ones. Every xAI generation request therefore sends `X-Sub2API-Grok-Client-Tool-Cache: off`, overriding any value from other headers, so local tools stay local. On Free accounts this gives up that cache-capable route and can raise prompt costs. The extension registers no search tool and calls no search endpoint for xAI entries.

| Feature                                                                                   | xAI entry                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/compact`, threshold and overflow compaction                                             | Pi's ordinary textual summary through the selected Grok model                         |
| `/toggle-fast`, `/toggle-ultrafast`, `/toggle-daybreak`, `/sub2api-save`, `/toggle-ultra` | Rejected for the selected xAI model; nothing changes in memory or on disk             |
| `/openai-compress`                                                                        | Rejected; native Codex compaction is for Codex models only                            |
| Usage footer                                                                              | The entry's own usage; no `[FAST]`, `[ULTRAFAST]`, `[DAYBREAK]`, or `[ULTRA ENABLED]` |

The same rules apply to every model of the entry, whatever its ID. Other entries keep their own request modes and toggles when you switch to and from an xAI model.

### Request modes

Fast, Ultrafast, and Daybreak are request modes. Each provider can store defaults in `requestModes` and per-model preferences in `modelRequestModes`, keyed by the exact model ID as discovered under that provider:

```json
{
  "my-relay": {
    "baseURL": "https://relay.example.com/v1",
    "token": "${SUB2API_TOKEN}",
    "api": "openai-responses",
    "requestModes": { "serviceTier": "fast", "daybreak": "blue" },
    "modelRequestModes": {
      "your-openai-model-id": { "serviceTier": "default" }
    }
  }
}
```

Both objects accept two optional fields:

| Field         | Values                               | Request field                                               |
| ------------- | ------------------------------------ | ----------------------------------------------------------- |
| `serviceTier` | `"default"`, `"fast"`, `"ultrafast"` | `service_tier`: `"default"`, `"priority"`, or `"ultrafast"` |
| `daybreak`    | `"standard"`, `"blue"`               | `access_programs.cyber`: `"standard"` or `"daybreak_blue"`  |

Each field resolves independently, first match wins: the current model's unsaved toggle, its `modelRequestModes` entry, the provider's `requestModes`, and otherwise no change to the request. In the example, `your-openai-model-id` sends `service_tier: "default"` with Daybreak Blue, while other eligible models of `my-relay` inherit Fast and Blue. The same model ID under another provider uses only that provider's settings. `default` and `standard` are explicit choices that override an inherited Fast/Ultrafast or Blue; they are not the same as leaving the field out. To return a field to inheritance, delete it (or the model entry) from the file and run `/reload`.

Model keys follow the `compress_model` rules (1–256 characters, no surrounding whitespace or control characters). A `null`, non-object, or unknown value fails configuration loading with an error naming the provider and field; other keys inside a modes object are ignored, so a misspelled field such as `service_tier` has no effect. These settings only choose what the extension sends; they do not establish that a model or account is eligible for a tier or program, and the upstream reports any rejection.

Mode commands change only the selected provider/model, in memory:

- `/toggle-fast` and `/toggle-ultrafast` select a tier. They are mutually exclusive; toggling the active tier off selects `default`.
- `/toggle-daybreak` switches between Blue and `standard`; from an unset state it selects Blue. It is independent of the tier, so either tier can be combined with Daybreak.

Unsaved changes stay with their model when you switch models and disappear on `/reload` or restart. A command that does not apply to the selected model (see [Routing behavior](#routing-behavior)) is rejected without changing anything.

Save explicitly with `/sub2api-save`:

```text
/sub2api-save
/sub2api-save provider
```

Without an argument it writes the selected model's current effective modes to `modelRequestModes["<model>"]`. With `provider` it writes them to that provider's `requestModes`. Either form replaces only the target object with every field that currently resolves to a value, including inherited ones, so the saved scope pins them; with `provider` this includes values from the current model's own `modelRequestModes` entry; with nothing set it saves `{}`. Saving the provider defaults does not remove model entries, so existing model-specific preferences, including the current model's, still take precedence. Other models' unsaved toggles, `/toggle-ultra`, and compaction settings are never saved, and nothing is saved automatically.

A save rereads `sub2api.json`, changes only the target object, and atomically replaces the file (the target of a symlink) while keeping its permissions; credential expressions such as `${VAR}` and `!command` are written back literally and never executed by a save. The file is rewritten as JSON with two-space indentation, so custom formatting is not preserved. Saves within one extension instance run one at a time; saves from two instances (for example across `/reload`) or two Pi processes at the same moment are last-writer-wins. A missing or invalid file or provider fails the save without writing and leaves unsaved toggles in effect.

### Codex compaction model

Set `compress_model` on a provider in `sub2api.json` to use a different model for native Codex compaction:

```json
{
  "codex-relay": {
    "baseURL": "https://relay.example.com/v1",
    "token": "${SUB2API_TOKEN}",
    "api": "openai-codex-responses",
    "compress_model": "gpt-5-mini",
    "compress_service_tier": "fast"
  }
}
```

Omitting `compress_model` or setting it to `null` uses the current conversation model. A configured value must be a non-empty model ID, without surrounding whitespace or control characters (maximum 256 characters). Requests still use this provider's endpoint and credentials; the selected model must support native compaction on that relay. It does not change the conversation model, checkpoint replay identity, or Pi's fallback textual compaction. `compress_service_tier` applies independently.

Model IDs do not need to appear in discovery. Usage costs use the selected model's registered pricing when available; undiscovered override models retain token usage but report zero estimated cost rather than the conversation model's prices.

### One-off OpenAI compaction

When discovery finds models routed through `openai-codex-responses` and the host supports native compaction, the extension registers `/openai-compress [model] [tier]`. It can only run while the current model is a Sub2API Codex model and the session is idle.

```text
/openai-compress
/openai-compress gpt-5-mini
/openai-compress fast
/openai-compress gpt-5-mini fast
/openai-compress default
```

Both arguments are optional. A single `default`, `fast`, or `ultrafast` argument is treated as the tier, not a model name. Explicit arguments override `compress_model` / `compress_service_tier` for this compaction only; omitted arguments keep the configured defaults and then fall back to the current conversation model and its resolved tier. `default` explicitly sends `service_tier: "default"`, `fast` sends `"priority"`, and `ultrafast` sends `"ultrafast"`.

This does not change the selected conversation model, request modes, configuration, or later automatic compactions. Failed command-triggered native compaction is cancelled rather than silently falling back to a different textual compaction path. The command remains registered when switching models, but rejects unsupported models at execution time.

### Codex compaction service tier

Set `compress_service_tier` on a provider in `sub2api.json` to override the service tier for native Codex compaction only:

| Value             | Compaction request                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `"fast"`          | Sends `service_tier: "priority"`                                                                                                |
| `"ultrafast"`     | Sends `service_tier: "ultrafast"`                                                                                               |
| `null` or omitted | Uses the conversation model's resolved `serviceTier` ([Request modes](#request-modes)); omits `service_tier` when none resolves |

A non-null configuration takes precedence over the conversation model's tier. The fallback follows the conversation model even when `compress_model` names another model, sends an explicit `default` as `service_tier: "default"`, and never adds Daybreak to the compaction request. It does not change ordinary conversation requests or Pi's fallback textual compaction. The relay must support the selected tier.

### Provider-hosted tools

Use the optional `serverTools` object to append provider-executed tools to every matching model request:

```json
{
  "openai-tools": {
    "baseURL": "https://relay.example.com/v1",
    "token": "replace-with-token",
    "api": "openai-responses",
    "serverTools": {
      "responses": [
        { "type": "web_search" },
        {
          "type": "file_search",
          "vector_store_ids": ["vs_replace_me"]
        },
        {
          "type": "code_interpreter",
          "container": { "type": "auto" }
        },
        {
          "type": "shell",
          "environment": { "type": "container_auto" }
        },
        {
          "type": "mcp",
          "server_label": "docs",
          "server_url": "https://mcp.example.com/sse",
          "require_approval": "never"
        },
        {
          "type": "tool_search",
          "execution": "server",
          "description": "Load hosted tools only when needed"
        }
      ]
    }
  },
  "claude-tools": {
    "baseURL": "https://relay.example.com/v1",
    "token": "replace-with-token",
    "api": "anthropic-messages",
    "serverTools": {
      "anthropic": [
        {
          "type": "web_search_20260209",
          "name": "web_search",
          "max_uses": 5
        },
        {
          "type": "web_fetch_20260309",
          "name": "web_fetch",
          "max_uses": 3
        },
        {
          "type": "code_execution_20260120",
          "name": "code_execution"
        },
        {
          "type": "tool_search_tool_regex_20251119",
          "name": "tool_search_tool_regex"
        }
      ]
    }
  }
}
```

`serverTools.responses` applies to `openai-responses` and `openai-codex-responses`. Supported provider-hosted families are:

- Web search: `web_search`, `web_search_2025_08_26`, `web_search_preview`, and `web_search_preview_2025_03_11`.
- File search: `file_search`; `vector_store_ids` must contain at least one ID.
- Hosted Python: `code_interpreter`; set `container` to a container ID or `{ "type": "auto" }`.
- Hosted shell: `shell`; `environment` must be `container_auto` or `container_reference`. Container skills and network policies may be nested in that environment.
- Remote MCP/connectors: `mcp`; set `server_label`, either `server_url` or `connector_id`, and `require_approval` to `"never"`. Pi cannot answer an upstream MCP approval prompt.
- Deferred hosted tool discovery: `tool_search`; `execution` must be `"server"`.

`serverTools.anthropic` applies to `anthropic-messages`. Supported provider-hosted families are Anthropic's versioned `web_search_*`, `web_fetch_*`, `code_execution_*`, `tool_search_tool_regex*`, and `tool_search_tool_bm25*` definitions. Their required `name` is validated. The exact version must be supported by the selected model, relay, and upstream account.

Definitions are appended verbatim after Pi's normal function tools; exact duplicates are not appended. The extension accepts unknown future tool types so new provider-hosted definitions do not require an extension release. Upstream schema, model eligibility, account permissions, billing, and regional restrictions still apply.

This is intentionally not an `enable-tool` boolean: neither protocol defines a safe “enable every tool” request. File search needs vector-store IDs, MCP may need credentials, hosted containers have resource and network policy, and Anthropic tool versions are model-specific. Explicit definitions make those capabilities and costs reviewable.

Safety and compatibility limits:

- `openai-completions` has no provider-hosted tool injection.
- Responses `function`, `custom`, `namespace`, `local_shell`, `apply_patch`, and computer-use tools require Pi-side execution and are rejected here. Pi already supplies its own function tools.
- Responses `image_generation` is rejected because Pi's current Responses adapter cannot retain its image output.
- Anthropic `bash_*`, `computer_*`, `memory_*`, and `text_editor_*` definitions require a client-side execution loop and are rejected.
- Provider-specific call/result blocks and citation metadata are not persisted as Pi tool calls. The provider executes the configured tool inside the model request, and Pi retains the final assistant text. Generated files and other provider-only artifacts may therefore be unavailable.
- MCP `authorization`, custom MCP headers, and other secrets are sent unchanged and stored as clear text in `sub2api.json`; protect the file accordingly.

When `api` is fixed, only its matching `serverTools` group is accepted. An auto-routed relay may configure both groups; each discovered model receives only the group matching its selected API.

## Model discovery

Providers configured with `"api": "openai-codex-responses"` use `GET /backend-api/codex/models` as their sole model inventory. The extension does not request `/v1/models`, including when the manifest is unavailable, invalid, or empty. Manifest failures are logged and leave that provider without discovered models.

Each valid manifest `slug` becomes the Pi model ID, and `display_name` supplies its name. `supported_reasoning_levels` determines reasoning support and selectable thinking efforts, so new model families do not need name-pattern updates. Missing, empty, or unrecognized reasoning levels do not enable thinking. `input_modalities` supplies Pi's supported `text`/`image` inputs; unrecognized modalities are ignored, and missing usable modalities default to text-only. Remote token limits are used when available, with Pi's catalog and existing defaults filling missing limits and prices. Codex-specific instructions and internal flags are not injected into Pi.

Providers without an explicit Codex API setting keep `/v1/models` as their authoritative inventory, with best-effort Codex manifest enrichment. Set `api` explicitly to opt a Codex-only relay out of standard model discovery; automatic routing is retained for relays that mix OpenAI, Claude, or other model families.

## Routing behavior

When a provider does not set `api`, model IDs select an API as follows:

- `claude-*` → `anthropic-messages`
- OpenAI IDs such as `gpt-*`, `codex-*`, `chatgpt-*`, and `o3-*` → `openai-codex-responses`
- Other IDs, including `grok-*` → `openai-responses`

Sub2API Grok groups should use an [xAI entry](#xai-grok-entries) instead, which this list does not apply to.

Anthropic models are registered directly with pi's built-in Anthropic Messages implementation and a model-level base URL without `/v1`. Claude 4.6+ models receive `compat.forceAdaptiveThinking`.

Codex models use pi's Codex Responses adapter so requests keep the Codex shape (instructions, `store: false`, encrypted reasoning, forced SSE). Sub2API relays do not expose ChatGPT's `/v1/codex/responses` passthrough route, so at the request boundary the extension rewrites the request URL to the relay's standard `/v1/responses` endpoint, drops the generated `chatgpt-account-id` header, and replaces only the fake JWT bearer credential with the relay token.

Codex models also use OpenAI's Remote Compaction V2 protocol when pi runs `/compact`, threshold compaction, or overflow recovery. The extension serializes pi's active session into Responses input items, appends a `compaction_trigger`, and streams `POST /v1/responses` with `x-codex-beta-features: remote_compaction_v2` and the real relay bearer token. It retains the newest replayable user messages locally within budgets of 64,000 estimated tokens and 16 MiB, collects exactly one encrypted `compaction` output item from `response.output_item.done`, waits for `response.completed`, and persists that native window in the compaction entry's `details`. Before later Codex Responses calls, it replaces pi's textual summary replay plus its pre-compaction kept window with the stored native window, followed by the live post-compaction tail. Repeated compactions compact the previous native window together with the new tail instead of nesting textual checkpoint markers.

If the first native compact request fails, pi's normal textual compaction remains the fallback. Once an opaque native checkpoint is active, a failed repeated compaction is cancelled rather than replacing the only replayable checkpoint with a summary of its local marker. Native checkpoints are bound to the provider, model, API, and normalized relay Responses URL; switching any of those leaves the opaque state untouched rather than forwarding it to a different endpoint. Existing version-1 checkpoints created through the retired standalone endpoint remain replayable and are upgraded when they are compacted again.

When a relayed Codex stream reports or throws an upstream error, including `Upstream request failed` and `stream_read_error`, the error is surfaced to pi unchanged so pi's own retry handling can retry the turn. Context-window overflow errors reach pi the same way, allowing its normal compaction recovery to run.

[Request modes](#request-modes) apply to OpenAI model IDs only. Fast (`service_tier: "priority"`) and an explicit `default` tier apply to Codex Responses, OpenAI Responses, and Chat Completions requests. Ultrafast (`service_tier: "ultrafast"`) and Daybreak (`access_programs.cyber`, preserving other `access_programs` fields) apply only to Codex Responses and OpenAI Responses; a saved Ultrafast or Daybreak preference stays stored but is neither sent nor shown for a Chat Completions model. The usage footer shows `[FAST]`, `[ULTRAFAST]`, and `[DAYBREAK]` for the selected model's active modes. Without a resolved Daybreak setting the field stays untouched, which can let the upstream select Daybreak automatically; `standard` opts out explicitly. Daybreak selects Blue, not Red, and grants no access by itself. Ultrafast does not change reasoning effort and may carry higher upstream charges.

The relay remains responsible for model/account eligibility and tier policy; current Sub2API versions derive the upstream `x-codex-routing-hint` from the final model and service tier, so the extension does not forge that gateway-owned header. The protocol was checked against [Codex commit `550eb505`](https://github.com/openai/codex/tree/550eb50545a78468a09ce86b82426338640ef22d), including `cyber_access_program.rs` and service-tier tests, plus the official [Daybreak](https://developers.openai.com/api/docs/guides/daybreak) and [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) guides.

Reasoning models use the upstream Codex manifest's `supported_reasoning_levels` when available, so pi exposes only the efforts declared for each model. Pi has one highest UI level, `max`; by default it sends the upstream `max` effort when advertised. Run `/toggle-ultra` to switch the current session into ultra mode: the command selects Pi's `max` level, remaps it to the upstream `ultra` effort for models that advertise it, and adds `[ULTRA ENABLED]` to the usage footer. Run it again to restore the normal `max` wire value. This lets models such as `gpt-5.6` use their highest `gpt-5.6-sol` effort without adding a Pi-only level name. `minimal` still clamps to `low` because relayed Codex backends reject the `minimal` and `none` efforts. The Codex adapter omits the `reasoning` field when thinking is off; for plain OpenAI Responses models, `off` is not selectable, which makes that adapter omit the field as well. If the manifest is unavailable or omits the capability field, the previous `low` through `xhigh` compatibility mapping remains the fallback.

OpenAI Responses and Chat Completions models use pi's built-in implementations and call `/v1/responses` and `/v1/chat/completions`, respectively.

## Quota reporting

At startup and during quota refreshes, the extension queries Sub2API's API-key billing endpoint, `GET /v1/sub2api/billing`. When it returns a valid v1 token-billing contract, the extension applies its `effective_rate_multiplier` to pi's built-in per-token prices for known models, including long-context pricing tiers. Models absent from pi's catalog keep zero estimated prices because Sub2API does not expose an absolute model price table through this endpoint.

For the active provider, the extension also probes a root `/usage` compatibility route and then Sub2API's official `GET /v1/usage` endpoint. A recognized response may contain key quotas, `rate_limits`, subscription daily/weekly/monthly usage, `daily_usage`, and `usage.today`/`usage.total` data; camelCase aliases are accepted for compatible relays.

Usage refreshes run in the background on `session_start`, `model_select`, and `turn_end`. The extension registers `/toggle-ultra`, `/toggle-fast`, `/toggle-ultrafast`, `/toggle-daybreak`, and `/sub2api-save`, and installs a custom footer that keeps the project path first, followed by pi's token/model statistics and other extension statuses, then adds usage as its own final row. Keeping usage outside the shared status row prevents it from being joined with MCP and similar extension statuses:

```text
my-relay · loading…
my-relay · d 24% · w 11% · m 7%
my-relay · d $200.74 · 317.7m tok [ULTRA ENABLED] [FAST]
my-relay · d $200.74 · 317.7m tok [ULTRAFAST] [DAYBREAK]
```

The dedicated usage row intentionally omits leading padding, status icons, the `usage` label, and billing multipliers to keep the completed state compact. Providers without a compatible usage endpoint continue to work normally; their usage row changes to `my-relay · usage unavailable` instead of disappearing silently. Pi exposes one custom-footer slot, so another extension that replaces the entire footer can override this layout; extensions that only call `setStatus`, including MCP status integrations, remain on their own row above usage.

The billing endpoint reports a token-price multiplier, not the purchase price of a subscription plan. The latter is not available through Sub2API's API-key-authenticated contract.

Additional behavior:

- Model discovery and billing requests use a 5-second timeout per attempt. Usage requests use a 30-second timeout because `/v1/usage` may aggregate a large history before responding. Transient network errors plus HTTP 408, 425, 429, 500, 502, 503, and 504 responses are retried up to twice with one- and two-second exponential backoff.
- Models whose IDs start with `gpt-image` are excluded.
- Outside explicit Codex manifest discovery, IDs containing `claude`, `codex`, `gpt-5`, or `gpt-6` are exposed as reasoning models.
- For automatically routed and non-Codex providers, `GET /v1/models` remains the authoritative model inventory. When an OpenAI model is missing token limits or reasoning-effort capabilities, the extension best-effort merges metadata for the same model ID from Sub2API's `GET /backend-api/codex/models` manifest; manifest-only models are not registered in this mode. The `gpt-5.6` inventory alias uses `gpt-5.6-sol` metadata.
- Remote model metadata accepts `context_window`, `contextWindow`, `context_length`, `max_context_tokens`, `max_input_tokens`, `limit.context`, and `limits.context` for context size. Output limits accept `max_tokens`, `maxTokens`, `max_output_tokens`, `max_completion_tokens`, `limit.output`, and `limits.output`; the first valid positive integer is used, so an invalid earlier alias does not hide a valid later one. Supported thinking efforts are read from `supported_reasoning_levels` or `supportedReasoningLevels`, accepting both Codex object entries such as `{ "effort": "ultra" }` and string values.
- Missing context windows are filled from pi's catalog for the selected API (`anthropic`, `openai-codex`, or `openai`). Missing OpenAI output limits also use the catalog; Anthropic output limits retain relay-safe defaults (16,384 tokens, or 8,192 for Haiku 4.5), capped to the context window, unless the relay explicitly provides a valid output limit. Catalog context windows describe model capacity, not a guarantee that every relay account supports it; Claude context windows are not inferred from Sub2API's generated Codex manifest. When the host SDK supports it, the extension restores Pi's locally cached runtime catalog offline to pick up newly added models and updated limits/prices, then falls back to the bundled static catalog. This does not refresh catalogs over the network or add models absent from the relay inventory. Missing/unreadable caches and older hosts keep the static fallback. Only fields still unavailable after remote and catalog lookup fall back to a 200,000-token context window and a model-family-specific output limit.
- Each Codex remote compaction attempt has a three-minute timeout. Attempts reject redirects, cap the SSE response at 32 MiB, and retain at most 64,000 estimated message tokens or 16 MiB of replay messages so native checkpoints remain bounded.
- Network interception is request-scoped; process-wide transports are never patched.

## Security

The configuration may contain plaintext API tokens. Use an environment variable reference (`"token": "${SUB2API_TOKEN}"`) to keep secrets out of the file; a referenced variable must be set to a non-empty value before pi starts. Keep the file outside repositories and restrict its permissions:

```bash
chmod 600 ~/.pi/agent/sub2api.json
```

Use HTTPS for remote relays. Plain HTTP is accepted for trusted local development endpoints only. Base URLs containing embedded credentials, query strings, or fragments are rejected. Authenticated discovery, Codex-manifest, billing, quota, and wrapped Codex requests reject redirects, and discovery/manifest/billing/quota JSON responses are capped at 1 MiB.

## Troubleshooting

- **Provider does not appear:** inspect stderr for `[sub2api] failed to load ...`; verify that the JSON is valid and every entry has non-empty `baseURL` and `token` strings. A `token` referencing an unset environment variable fails with an error naming that variable.
- **No models appear:** for explicit `openai-codex-responses` providers, verify that the relay's `/backend-api/codex/models` endpoint returns a `models` array with `Authorization: Bearer <token>`; failures are logged as `[sub2api:<provider>] failed to fetch Codex model manifest`, without falling back to `/v1/models`. Other providers require `<baseURL>/v1/models`; their discovery failures are logged as `[sub2api:<provider>] failed to fetch models`.
- **Requests fail:** confirm the configured API is supported by the relay: Anthropic Messages uses `/v1/messages`, Codex generation and Remote Compaction V2 both use `/v1/responses`, OpenAI Responses uses `/v1/responses`, and Chat Completions uses `/v1/chat/completions`.
- **Fast mode is rejected:** verify that the selected OpenAI model/account supports `service_tier: "priority"` and that the Sub2API OpenAI Fast policy allows it. Request modes deliberately leave relay eligibility and policy enforcement to Sub2API.
- **Request mode save fails:** the error names the cause; fix the file (valid JSON object, provider present) and run `/sub2api-save` again. Unsaved toggles remain in effect until reload.
- **Native compaction falls back:** verify that the relay supports Remote Compaction V2 on streamed `POST /v1/responses`: the request must end with a `compaction_trigger`, and the SSE response must contain exactly one encrypted `compaction` item in `response.output_item.done` followed by `response.completed`. The extension also accepts the `compaction_summary` type emitted by compatible Codex relays.
- **Usage unavailable:** verify that the relay's `/v1/usage` endpoint returns JSON with subscription, quota, rate-limit, or usage data for the configured bearer token. The root `/usage` route is probed only for compatibility with other relays.
- **Price multiplier missing:** verify that `<baseURL>/v1/sub2api/billing` returns the v1 token-billing contract: `object: "sub2api.key_billing"`, `schema_version: 1`, `billing_scope: "token"`, non-negative `group_rate_multiplier`, `resolved_rate_multiplier`, and `effective_rate_multiplier` values, plus a boolean `peak_rate_enabled`. Sub2API simple mode returns 404 and therefore uses pi's standard built-in prices.
- **Custom agent directory:** ensure `sub2api.json` is directly inside the directory named by `PI_CODING_AGENT_DIR`.

## Development

From the repository root:

```bash
npm install
npm run format
npm run lint
npm run check
```

## Acknowledgements

The quota workflow is informed by the MIT-licensed [`dereknex/pi-sub2api-provider`](https://github.com/dereknex/pi-sub2api-provider) project and adapted to this package's `sub2api.json` configuration and native Pi provider routing. The native compaction hook design is informed by the MIT-licensed [`jordyvandomselaar/pi-openai-compaction`](https://github.com/jordyvandomselaar/pi-openai-compaction) extension and adapted to Sub2API relay authentication and routing.

## License

MIT
