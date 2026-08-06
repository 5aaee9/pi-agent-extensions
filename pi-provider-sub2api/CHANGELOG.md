# Changelog

## 0.1.5 - 2026-08-06

- Report relay usage on the final footer line, with automatic refreshes on session start, model selection, and turn end; remove the `/quota` command.
- Show loading and unavailable states so the usage line no longer disappears while the endpoint is pending or unsupported.
- Keep the usage footer line compact and flush-left by omitting leading padding, status icons, the `usage` label, and billing multipliers.
- Allow usage requests 30 seconds per attempt so relays with slow aggregate usage queries do not fail the previous 5-second timeout.

## 0.1.4 - 2026-08-06

- Read Sub2API's `GET /v1/sub2api/billing` multiplier and apply it to pi's built-in model prices, including long-context tiers.
- Parse official subscription, key-quota, aggregate-usage, and daily-usage fields from `GET /v1/usage`.
- Show the effective price multiplier plus subscription usage in the footer, and include plan, subscription-window, and key-quota details in `/quota`.

## 0.1.3 - 2026-08-06

- Enrich OpenAI model token limits from Sub2API's Codex manifest while keeping `/v1/models` authoritative for model availability, and resolve remaining limits from pi's API-specific built-in catalog.
- Map the `gpt-5.6` inventory alias to `gpt-5.6-sol` metadata and let later valid metadata aliases recover from invalid earlier values.

## 0.1.2 - 2026-08-06

- Rewrite Codex adapter requests from `/v1/codex/responses` to the relay's standard `/v1/responses` endpoint at the request boundary, and drop the fake `chatgpt-account-id` header. Sub2API relays do not expose ChatGPT's Codex passthrough route, so Codex models previously failed with `404 page not found`.
- Clamp the `minimal` thinking level to `low`; relayed Codex backends reject the `minimal` and `none` efforts with upstream 5xx errors. For plain OpenAI Responses models, `off` is no longer a selectable thinking level so the adapter omits the `reasoning` field instead of sending the unsupported `none` effort.

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
