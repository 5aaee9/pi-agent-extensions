# Changelog

## Unreleased

## 0.1.18 - 2026-08-24

- Add `/toggle-fast` to send OpenAI requests with `service_tier: "priority"` and show `[FAST]` in the usage footer while enabled.
- Add protocol-specific `serverTools.responses` and `serverTools.anthropic` configuration for provider-hosted tools, with request merging, compatibility checks, and explicit rejection of tools that require Pi-side execution or unsupported output handling.

## 0.1.17 - 2026-08-21

- Add `/toggle-ultra` to switch max-thinking requests between the upstream `max` and `ultra` efforts, and mark the enabled state in the usage footer.
- Merge reasoning capabilities from the relay inventory and Codex manifest so a manifest-only `ultra` effort is not hidden by a lower `max` inventory entry.

## 0.1.16 - 2026-08-20

- Map Pi's `max` thinking level to the upstream `ultra` reasoning effort when advertised, while preserving `max` for models that use that wire value.

## 0.1.15 - 2026-08-20

- Discover per-model reasoning efforts from upstream `supported_reasoning_levels`, including `max` for the `gpt-5.6`/`gpt-5.6-sol` alias when advertised.

## 0.1.14 - 2026-08-16

- Load under OMP (oh-my-pi): probe pi's Codex adapter, `buildContextEntries`, and the private serializer runtime optionally instead of importing them statically, degrade Codex-shaped models to plain `openai-responses` and skip native compaction when the host cannot provide them, and guard the footer API. Pi behavior is unchanged.

## 0.1.13 - 2026-08-16

- Return Codex context-window overflow errors to Pi immediately instead of retrying them indefinitely, allowing Pi's compaction recovery to run.

## 0.1.12 - 2026-08-14

- Keep relayed Codex streams active with no-op progress events during buffered attempts and long retry backoffs so Pi's provider-stall watchdog does not abort an active retry.

## 0.1.11 - 2026-08-14

- Retry all relayed Codex upstream errors indefinitely, including `Upstream request failed`, while preserving active-turn cancellation.

## 0.1.10 - 2026-08-10

- Emit the relayed Codex stream lifecycle start when generation actually begins, so timing extensions measure real elapsed time instead of seeing synthetic start and terminal events in the same tick.

## 0.1.9 - 2026-08-07

- Retry relayed Codex `stream_read_error` failures indefinitely with exponential backoff from one second up to a 30-minute maximum interval, while preserving cancellation and leaving other errors terminal.

## 0.1.8 - 2026-08-06

- Restore Pi 0.84 startup compatibility by loading the pinned private Codex serializer runtime through absolute module URLs, avoiding Pi/Jiti's public `pi-ai` root alias rewriting private `api/*` imports under `compat.js`.
- Validate the published extension with Pi's real extension loader, update its pinned serializer runtime and development packages to 0.84.0, and retain host loading compatibility with Pi 0.83.

## 0.1.7 - 2026-08-06

- Fix npm-installed extension startup by installing the `pi-ai` runtime needed by the native Codex compaction serializers, while keeping Pi-provided public core packages as wildcard peers.

## 0.1.6 - 2026-08-06

- Add OpenAI Codex standalone server-side compaction for relay models using `openai-codex-responses`: serialize the active pi session to `POST /v1/responses/compact`, persist the returned native window in compaction details, and replace pi's textual summary replay with the opaque window plus the live tail on subsequent requests.
- Preserve repeated native checkpoints safely, account for compact-endpoint token usage, and fall back to pi compaction only before an opaque checkpoint becomes authoritative.
- Accept the `compaction_summary` output item emitted by Codex relays in addition to OpenAI's documented `compaction` item.
- Render a custom footer that preserves the project, token/model, and extension-status rows while placing relay usage on a dedicated final row below them.

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
