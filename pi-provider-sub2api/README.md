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

Reasoning models map thinking levels so relayed Codex backends accept them: `minimal` clamps to `low` and `xhigh` passes through, because the backends reject the `minimal` and `none` efforts. The Codex adapter omits the `reasoning` field when thinking is off; for plain OpenAI Responses models, `off` is not selectable, which makes that adapter omit the field as well.

OpenAI Responses and Chat Completions models use pi's built-in implementations and call `/v1/responses` and `/v1/chat/completions`, respectively.

## Quota reporting

For the active Sub2API provider, the extension automatically probes the relay's `/usage` and `/v1/usage` endpoints. A recognized response may contain `rate_limits`, `daily_usage`, and `usage.today`/`usage.total` data; camelCase aliases are accepted as well.

Quota refreshes run in the background on `session_start`, `model_select`, and `turn_end`. The built-in footer then shows a compact status such as:

```text
● my-relay 5h 24% · d 11% · w 7%
```

Run `/quota` for the current provider's detailed status, billing mode, daily request/token totals, costs, rate-limit usage, remaining quota, and reset times. Providers without a compatible usage endpoint continue to work normally and simply omit the quota status.

Additional behavior:

- Model discovery and quota requests use a 5-second timeout per attempt. Transient network errors plus HTTP 408, 425, 429, 500, 502, 503, and 504 responses are retried up to twice with one- and two-second exponential backoff.
- Models whose IDs start with `gpt-image` are excluded.
- IDs containing `claude`, `codex`, or `gpt-5` are exposed as reasoning models.
- Remote model metadata accepts `context_window`, `contextWindow`, `context_length`, `max_context_tokens`, `limit.context`, and `limits.context` for context size. Output limits accept `max_tokens`, `maxTokens`, `max_output_tokens`, `max_completion_tokens`, `limit.output`, and `limits.output`; positive numeric strings are normalized.
- Missing model metadata falls back to a 200,000-token context window and a model-family-specific output limit.
- Network interception is request-scoped; process-wide transports are never patched.

## Security

The configuration contains plaintext API tokens. Keep it outside repositories and restrict its permissions:

```bash
chmod 600 ~/.pi/agent/sub2api.json
```

Use HTTPS for remote relays. Plain HTTP is accepted for trusted local development endpoints only. Base URLs containing embedded credentials, query strings, or fragments are rejected. Authenticated discovery, quota, and wrapped Codex requests reject redirects, and discovery/quota JSON responses are capped at 1 MiB.

## Troubleshooting

- **Provider does not appear:** inspect stderr for `[sub2api] failed to load ...`; verify that the JSON is valid and every entry has non-empty `baseURL` and `token` strings.
- **No models appear:** verify that `<baseURL>/v1/models` is reachable with `Authorization: Bearer <token>`. Discovery failures are logged as `[sub2api:<provider>] failed to fetch models`.
- **Requests fail:** confirm the configured API is supported by the relay: Anthropic Messages uses `/v1/messages`, Codex models are rewritten to `/v1/responses`, OpenAI Responses uses `/v1/responses`, and Chat Completions uses `/v1/chat/completions`.
- **No quota status:** run `/quota` and verify that either `<baseURL>/usage` or the relay's `/v1/usage` endpoint returns JSON with `rate_limits`, `daily_usage`, or `usage` data for the configured bearer token.
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
4. Create and push a matching `v<version>` tag, such as `v0.1.1`.
5. Confirm the **Publish Package** workflow completed, then create the matching GitHub release.

The workflow requires the tag to exactly match the package version and publishes from a GitHub-hosted runner using npm's short-lived OIDC credentials.

## Acknowledgements

The quota workflow is informed by the MIT-licensed [`dereknex/pi-sub2api-provider`](https://github.com/dereknex/pi-sub2api-provider) project and adapted to this package's `sub2api.json` configuration and native Pi provider routing.

## License

MIT
