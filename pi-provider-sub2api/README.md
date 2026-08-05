# @indexyz/pi-provider-sub2api

A [pi](https://github.com/earendil-works/pi-mono) provider extension for Sub2API-compatible relays. It discovers models dynamically and registers every configured relay as a separate pi provider.

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

Codex models keep the configured `/v1` base URL and call `/v1/codex/responses`. The extension supplies the fake JWT required by pi's Codex adapter, forces SSE so request authentication can remain request-scoped, and replaces only that fake bearer credential with the relay token. The generated `chatgpt-account-id` header and request URL are left intact.

OpenAI Responses and Chat Completions models use pi's built-in implementations and call `/v1/responses` and `/v1/chat/completions`, respectively.

Additional behavior:

- Model discovery times out after 10 seconds per relay so an unreachable endpoint cannot block startup indefinitely.
- Models whose IDs start with `gpt-image` are excluded.
- IDs containing `claude`, `codex`, or `gpt-5` are exposed as reasoning models.
- Missing model metadata falls back to a 200,000-token context window and a model-family-specific output limit.
- Network interception is request-scoped; process-wide transports are never patched.

## Security

The configuration contains plaintext API tokens. Keep it outside repositories and restrict its permissions:

```bash
chmod 600 ~/.pi/agent/sub2api.json
```

Use HTTPS for remote relays. Plain HTTP is accepted for trusted local development endpoints only. Base URLs containing query strings or fragments are rejected.

## Troubleshooting

- **Provider does not appear:** inspect stderr for `[sub2api] failed to load ...`; verify that the JSON is valid and every entry has non-empty `baseURL` and `token` strings.
- **No models appear:** verify that `<baseURL>/v1/models` is reachable with `Authorization: Bearer <token>`. Discovery failures are logged as `[sub2api:<provider>] failed to fetch models`.
- **Requests fail:** confirm the configured API is supported by the relay: Anthropic Messages uses `/v1/messages`, Codex uses `/v1/codex/responses`, OpenAI Responses uses `/v1/responses`, and Chat Completions uses `/v1/chat/completions`.
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
4. Create and push a matching `v<version>` tag, such as `v0.2.0`.
5. Confirm the **Publish Package** workflow completed, then create the matching GitHub release.

The workflow requires the tag to exactly match the package version and publishes from a GitHub-hosted runner using npm's short-lived OIDC credentials.

## License

MIT
