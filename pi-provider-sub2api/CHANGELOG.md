# Changelog

## 0.1.0 - 2026-08-05

- Initial release.
- Discover relay models from the OpenAI-compatible `/v1/models` endpoint.
- Route Claude models through Anthropic Messages and other supported models through request-scoped Codex Responses SSE forwarding.
- Preserve literal relay tokens that contain pi config-expression characters such as `$` or a leading `!`.
- Bound model discovery with a per-relay startup timeout.
- Support multiple named relay providers from one configuration file.
