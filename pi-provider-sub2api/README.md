# @indexyz/pi-provider-sub2api

A [pi](https://github.com/earendil-works/pi-mono) provider extension for Sub2API-compatible relays. It discovers models dynamically, registers every configured relay as a separate pi provider, and reports relay quota usage in pi.

## Requirements

- pi 0.83.0 or newer
- Node.js 22.19 or newer
- A Sub2API-compatible relay exposing `GET /v1/models` and at least one supported generation endpoint

## Install

```bash
pi install npm:@indexyz/pi-provider-sub2api
```

To try the extension from this repository without installing it:

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
    "api": "anthropic-messages"
  },
  "another-relay": {
    "baseURL": "https://another.example.com/v1",
    "token": "replace-with-another-token",
    "api": "openai-codex-responses"
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

Each top-level key becomes the provider name shown by pi. `baseURL` may include the `/v1` suffix; the extension normalizes both forms. The optional `api` setting accepts `anthropic-messages`, `openai-codex-responses`, `openai-responses`, or `openai-completions`. When present, it is applied to every discovered model for that provider instead of inferring an API from model IDs.

The configuration directory follows `PI_CODING_AGENT_DIR` when that environment variable is set. Otherwise it defaults to `~/.pi/agent`.

Restart pi after creating the file, or run `/reload` in an interactive session. Then use `/model` to select a discovered model under the configured provider.

## Routing behavior

When a provider does not set `api`, model IDs select an API as follows:

- `claude-*` → `anthropic-messages`
- OpenAI IDs such as `gpt-*`, `codex-*`, `chatgpt-*`, and `o3-*` → `openai-codex-responses`
- Other IDs, including `grok-*` → `openai-responses`

Anthropic models are registered directly with pi's built-in Anthropic Messages implementation and a model-level base URL without `/v1`. Claude 4.6+ models receive `compat.forceAdaptiveThinking`.

Codex models use pi's Codex Responses adapter so requests keep the Codex shape (instructions, `store: false`, encrypted reasoning, forced SSE). Sub2API relays do not expose ChatGPT's `/v1/codex/responses` passthrough route, so at the request boundary the extension rewrites the request URL to the relay's standard `/v1/responses` endpoint, drops the generated `chatgpt-account-id` header, and replaces only the fake JWT bearer credential with the relay token.

Codex models also use OpenAI's standalone server-side compaction protocol when pi runs `/compact`, threshold compaction, or overflow recovery. The extension serializes pi's active session into Responses input items, sends `POST /v1/responses/compact` with the real relay bearer token, and persists the returned opaque output window in the compaction entry's `details`. Before later Codex Responses calls, it replaces pi's textual summary replay plus its pre-compaction kept window with that stored native window, followed by the live post-compaction tail. Repeated compactions compact the previous native window together with the new tail instead of nesting textual checkpoint markers.

If the first native compact request is unavailable or malformed, pi's normal textual compaction remains the fallback. Once an opaque native checkpoint is active, a failed repeated compaction is cancelled rather than replacing the only replayable checkpoint with a summary of its local marker. Native checkpoints are bound to the provider, model, API, and normalized relay Responses URL; switching any of those leaves the opaque state untouched rather than forwarding it to a different endpoint.

When a relayed Codex stream reports or throws an upstream error, including `Upstream request failed` and `stream_read_error`, the extension retries the complete model request indefinitely. Context-window overflow errors are returned immediately instead, allowing Pi to run its normal compaction recovery. Retry delays start at one second and double after each failure up to a maximum interval of 30 minutes. While an attempt or a longer backoff is still active, no-op stream activity is emitted every 30 seconds so Pi's stream watchdog does not mistake the extension's buffered retry cycle for a stalled provider. Cancelling the active turn aborts both the backoff wait and further retries. To prevent partial text or tool calls from a failed attempt leaking into the session, relayed Codex output is released to pi only after an attempt succeeds.

Reasoning models use the upstream Codex manifest's `supported_reasoning_levels` when available, so pi exposes only the efforts declared for each model. Pi has one highest UI level, `max`; by default it sends the upstream `max` effort when advertised. Run `/toggle-ultra` to switch the current session into ultra mode: the command selects Pi's `max` level, remaps it to the upstream `ultra` effort for models that advertise it, and adds `[ULTRA ENABLED]` to the usage footer. Run it again to restore the normal `max` wire value. This lets models such as `gpt-5.6` use their highest `gpt-5.6-sol` effort without adding a Pi-only level name. `minimal` still clamps to `low` because relayed Codex backends reject the `minimal` and `none` efforts. The Codex adapter omits the `reasoning` field when thinking is off; for plain OpenAI Responses models, `off` is not selectable, which makes that adapter omit the field as well. If the manifest is unavailable or omits the capability field, the previous `low` through `xhigh` compatibility mapping remains the fallback.

OpenAI Responses and Chat Completions models use pi's built-in implementations and call `/v1/responses` and `/v1/chat/completions`, respectively.

## Quota reporting

At startup and during quota refreshes, the extension queries Sub2API's API-key billing endpoint, `GET /v1/sub2api/billing`. When it returns a valid v1 token-billing contract, the extension applies its `effective_rate_multiplier` to pi's built-in per-token prices for known models, including long-context pricing tiers. Models absent from pi's catalog keep zero estimated prices because Sub2API does not expose an absolute model price table through this endpoint.

For the active provider, the extension also probes a root `/usage` compatibility route and then Sub2API's official `GET /v1/usage` endpoint. A recognized response may contain key quotas, `rate_limits`, subscription daily/weekly/monthly usage, `daily_usage`, and `usage.today`/`usage.total` data; camelCase aliases are accepted for compatible relays.

Usage refreshes run in the background on `session_start`, `model_select`, and `turn_end`. The extension registers `/toggle-ultra` and installs a custom footer that keeps the project path first, followed by pi's token/model statistics and other extension statuses, then adds usage as its own final row. Keeping usage outside the shared status row prevents it from being joined with MCP and similar extension statuses:

```text
my-relay · loading…
my-relay · d 24% · w 11% · m 7%
my-relay · d $200.74 · 317.7m tok [ULTRA ENABLED]
```

The dedicated usage row intentionally omits leading padding, status icons, the `usage` label, and billing multipliers to keep the completed state compact. Providers without a compatible usage endpoint continue to work normally; their usage row changes to `my-relay · usage unavailable` instead of disappearing silently. Pi exposes one custom-footer slot, so another extension that replaces the entire footer can override this layout; extensions that only call `setStatus`, including MCP status integrations, remain on their own row above usage.

The billing endpoint reports a token-price multiplier, not the purchase price of a subscription plan. The latter is not available through Sub2API's API-key-authenticated contract.

Additional behavior:

- Model discovery and billing requests use a 5-second timeout per attempt. Usage requests use a 30-second timeout because `/v1/usage` may aggregate a large history before responding. Transient network errors plus HTTP 408, 425, 429, 500, 502, 503, and 504 responses are retried up to twice with one- and two-second exponential backoff.
- Models whose IDs start with `gpt-image` are excluded.
- IDs containing `claude`, `codex`, or `gpt-5` are exposed as reasoning models.
- `GET /v1/models` remains the authoritative model inventory. When an OpenAI model is missing token limits or reasoning-effort capabilities, the extension best-effort merges metadata for the same model ID from Sub2API's `GET /backend-api/codex/models` manifest; manifest-only models are never registered. The `gpt-5.6` inventory alias uses `gpt-5.6-sol` metadata.
- Remote model metadata accepts `context_window`, `contextWindow`, `context_length`, `max_context_tokens`, `limit.context`, and `limits.context` for context size. Output limits accept `max_tokens`, `maxTokens`, `max_output_tokens`, `max_completion_tokens`, `limit.output`, and `limits.output`; the first valid positive integer is used, so an invalid earlier alias does not hide a valid later one. Supported thinking efforts are read from `supported_reasoning_levels` or `supportedReasoningLevels`, accepting both Codex object entries such as `{ "effort": "ultra" }` and string values.
- Missing OpenAI model limits are filled from pi's catalog for the selected API (`openai-codex` or `openai`). Only fields still unavailable after remote and catalog lookup fall back to a 200,000-token context window and a model-family-specific output limit.
- Codex standalone compaction requests have a three-minute timeout, reject redirects, and cap compact response JSON at 32 MiB so retained native windows can contain images without allowing unbounded responses.
- Network interception is request-scoped; process-wide transports are never patched.

## Security

The configuration contains plaintext API tokens. Keep it outside repositories and restrict its permissions:

```bash
chmod 600 ~/.pi/agent/sub2api.json
```

Use HTTPS for remote relays. Plain HTTP is accepted for trusted local development endpoints only. Base URLs containing embedded credentials, query strings, or fragments are rejected. Authenticated discovery, Codex-manifest, billing, quota, and wrapped Codex requests reject redirects, and discovery/manifest/billing/quota JSON responses are capped at 1 MiB.

## Troubleshooting

- **Provider does not appear:** inspect stderr for `[sub2api] failed to load ...`; verify that the JSON is valid and every entry has non-empty `baseURL` and `token` strings.
- **No models appear:** verify that `<baseURL>/v1/models` is reachable with `Authorization: Bearer <token>`. Discovery failures are logged as `[sub2api:<provider>] failed to fetch models`.
- **Requests fail:** confirm the configured API is supported by the relay: Anthropic Messages uses `/v1/messages`, Codex models are rewritten to `/v1/responses` and use `/v1/responses/compact` for compaction, OpenAI Responses uses `/v1/responses`, and Chat Completions uses `/v1/chat/completions`.
- **Native compaction falls back:** verify that the relay supports `POST /v1/responses/compact` for the selected model and returns a `response.compaction` object whose `output` contains retained user messages followed by one encrypted `compaction` item. The extension accepts both OpenAI's documented `compaction` type and the `compaction_summary` type emitted by compatible Codex relays.
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
npm run pack:sub2api
```

## Release checklist

Releases use npm trusted publishing through [`.github/workflows/publish.yml`](https://github.com/5aaee9/pi-agent-extensions/blob/main/.github/workflows/publish.yml); no long-lived npm token is stored in GitHub.

### Trusted publisher setup

The npm package's GitHub Actions trusted publisher is configured with:

- Organization or user: `5aaee9`
- Repository: `pi-agent-extensions`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

For each release:

1. Update the child package version and `CHANGELOG.md`.
2. Run `npm run check` and inspect `npm run pack:sub2api`.
3. Commit and push the release commit to `main`.
4. Create and push a matching `v<version>` tag, such as `v0.1.2`.
5. Confirm the **Publish Package** workflow completed, then create the matching GitHub release.

The workflow requires the tag to exactly match the package version and publishes from a GitHub-hosted runner using npm's short-lived OIDC credentials.

## Acknowledgements

The quota workflow is informed by the MIT-licensed [`dereknex/pi-sub2api-provider`](https://github.com/dereknex/pi-sub2api-provider) project and adapted to this package's `sub2api.json` configuration and native Pi provider routing. The native compaction hook design is informed by the MIT-licensed [`jordyvandomselaar/pi-openai-compaction`](https://github.com/jordyvandomselaar/pi-openai-compaction) extension and adapted to Sub2API relay authentication and routing.

## License

MIT
