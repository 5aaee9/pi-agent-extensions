# Changelog

## 0.1.1 - 2026-08-05

- Add optional per-provider `api` selection for Anthropic Messages, Codex Responses, OpenAI Responses, and OpenAI Chat Completions.
- Route Claude models through pi's built-in Anthropic implementation without custom stream forwarding.
- Add OpenAI Responses fallback routing for non-Anthropic and non-OpenAI model IDs such as Grok.
- Preserve Codex request URLs and `chatgpt-account-id` headers while replacing only the fake JWT bearer credential at the request boundary.
- Migrate tests to Vitest and add repository-wide Oxlint and Oxfmt checks.
- Auto-detect `/usage` and `/v1/usage`, parse rate limits and daily usage, refresh quota on session/model/turn lifecycle events, show compact footer status, and add `/quota` details.
- Add a 5-second per-attempt timeout with two exponential-backoff retries for model and quota requests.
- Parse remote context/output limits from snake_case, camelCase, nested `limit`/`limits`, and numeric-string aliases.
- Abort quota work on session shutdown, reject authenticated redirects and URL credentials, bound JSON response sizes, and prevent stale lifecycle results from updating the footer.

## 0.1.0 - 2026-08-05

- Initial release.
- Discover relay models from the OpenAI-compatible `/v1/models` endpoint.
- Route Claude models through Anthropic Messages and other supported models through request-scoped Codex Responses SSE forwarding.
- Preserve literal relay tokens that contain pi config-expression characters such as `$` or a leading `!`.
- Bound model discovery with a per-relay startup timeout.
- Support multiple named relay providers from one configuration file.
