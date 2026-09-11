# Changelog

## 0.1.27 - 2026-09-11

- Parse `max_input_tokens`/`maxInputTokens` (and `limit.input`) as context window sources, matching Anthropic-style catalogs.
- Add `reasoningPattern`, `modelDefaults`, and `fallbackModels` provider options for upstreams that do not publish capability metadata.
- Add `sessionAffinityHeader` to inject the pi session UUID (e.g. `x-session-id`) on every provider request, including retries.
- Register `refreshModels` on every provider so pi's native model refresh re-discovers catalogs; stored `auth.json` credentials take precedence over the configured `apiKey`.
- Fix `authHeader: "authorization"` with a `!command` apiKey: the command is now executed inside the generated `Bearer` header instead of being sent literally.

## 0.1.26

- Add generic OpenAI Chat Compatible, Anthropic Messages, and OpenAI Responses provider support.
- Add upstream model discovery with persistent, stale-safe caching.
- Map upstream reasoning capabilities and thinking levels into pi model metadata.
- Cache models.dev metadata and merge prices, limits, modalities, names, and reasoning fields without overriding upstream values.
