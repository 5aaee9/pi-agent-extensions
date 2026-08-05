# @indexyz/pi-provider-sub2api

A [pi](https://github.com/earendil-works/pi-mono) provider extension for Sub2API-compatible relays. It discovers models dynamically and registers every configured relay as a separate pi provider.

## Requirements

- pi 0.83.0 or newer
- Node.js 22.19 or newer
- A Sub2API-compatible relay exposing `GET /v1/models`, Anthropic Messages, and Codex/OpenAI Responses endpoints

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
    "token": "replace-with-your-token"
  },
  "another-relay": {
    "baseURL": "https://another.example.com/v1",
    "token": "replace-with-another-token"
  }
}
```

Each top-level key becomes the provider name shown by pi. `baseURL` may include the `/v1` suffix; the extension normalizes both forms.

The configuration directory follows `PI_CODING_AGENT_DIR` when that environment variable is set. Otherwise it defaults to `~/.pi/agent`.

Restart pi after creating the file, or run `/reload` in an interactive session. Then use `/model` to select a discovered model under the configured provider.

## Routing behavior

- Models whose IDs start with `claude-` use the Anthropic Messages API.
- Other discovered chat/reasoning models use the Codex Responses SSE transport and are sent to the relay's `/v1/responses` endpoint.
- Model discovery times out after 10 seconds per relay so an unreachable endpoint cannot block startup indefinitely.
- Models whose IDs start with `gpt-image` are excluded.
- IDs containing `claude`, `codex`, or `gpt-5` are exposed as reasoning models.
- Missing model metadata falls back to a 200,000-token context window and a model-family-specific output limit.

For non-Claude requests, the extension uses a request-scoped `fetch` wrapper. It rewrites only the configured relay's exact `/v1/codex/responses` URL when both generated identity headers match, replaces the generated credential with the configured relay token, and leaves unrelated requests untouched. It does not patch process-wide transports.

## Security

The configuration contains plaintext API tokens. Keep it outside repositories and restrict its permissions:

```bash
chmod 600 ~/.pi/agent/sub2api.json
```

Use HTTPS for remote relays. Plain HTTP is accepted for trusted local development endpoints only. Base URLs containing query strings or fragments are rejected.

## Troubleshooting

- **Provider does not appear:** inspect stderr for `[sub2api] failed to load ...`; verify that the JSON is valid and every entry has non-empty `baseURL` and `token` strings.
- **No models appear:** verify that `<baseURL>/v1/models` is reachable with `Authorization: Bearer <token>`. Discovery failures are logged as `[sub2api:<provider>] failed to fetch models`.
- **Requests fail:** confirm that Claude routes support `/v1/messages` and other supported models accept Responses requests at `/v1/responses`.
- **Custom agent directory:** ensure `sub2api.json` is directly inside the directory named by `PI_CODING_AGENT_DIR`.

## Development

From the repository root:

```bash
npm install
npm run check
npm run pack:sub2api
```

## Release checklist

1. Update the child package version and `CHANGELOG.md`.
2. Run `npm run check` and inspect `npm run pack:sub2api`.
3. Commit and push the release commit to `main`.
4. Confirm the npm identity with `npm whoami`, then publish with `npm publish --workspace @indexyz/pi-provider-sub2api`.
5. Tag the published version (for example `pi-provider-sub2api-v0.1.0`), push the tag, and create the matching GitHub release.

## License

MIT
