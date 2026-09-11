# Changelog

## 0.1.30 - 2026-09-11

- Add Ollama native chat API support (`api: "ollama-chat"`, aliases `ollama`, `ollama-chat-api`). Discovery uses `GET /api/tags` plus per-model `POST /api/show` to read capabilities (`thinking` → reasoning, `vision` → image input) and `model_info.*.context_length`; chat requests stream `POST /api/chat` NDJSON with thinking blocks, tool calls, usage (`prompt_eval_count`/`eval_count`/`prompt_eval_cached_count`), and `think` effort strings mapped through `thinkingLevelMap` (`low`/`medium`/`high`/`max`). A trailing `/v1` on `baseURL` is stripped for Ollama endpoints.

## 0.1.29 - 2026-09-11

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.28 - 2026-09-11

- Fix `authHeader: "authorization"` hiding all provider models: the API key was moved into an `Authorization` header and the registered `apiKey` cleared, but pi's availability check only counts `apiKey`/OAuth, so the provider was treated as unconfigured and its models were filtered out of `/model` and `--list-models`. The key now stays registered and pi's native `authHeader: true` flag emits `Authorization: Bearer <apiKey>` at request time. `!command` keys still use the generated header so the command output is wrapped in `Bearer`.

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
