# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

## Packages

- [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api) — dynamic provider support, model metadata discovery, and quota reporting for Sub2API-compatible relays.
- [`@indexyz/pi-custom-provider`](./pi-custom-provider) — generic OpenAI Chat Compatible, Anthropic Messages, and OpenAI Responses providers with model discovery and caching.
- [`@indexyz/pi-continue`](./pi-continue) — resume an interrupted or failed turn with pi's currently selected model.
- [`@indexyz/pi-skill`](./pi-skill) — Codex-style `$skill-name` invocation anywhere in a prompt.

The repository root is a private npm workspace. Install packages from npm with:

```bash
pi install npm:@indexyz/pi-provider-sub2api
pi install npm:@indexyz/pi-custom-provider
pi install npm:@indexyz/pi-continue
pi install npm:@indexyz/pi-skill
```

For local development:

```bash
npm install
npm run format
npm run lint
npm run check
pi -e ./pi-provider-sub2api/index.ts
pi -e ./pi-custom-provider/index.ts
pi -e ./pi-continue/index.ts
pi -e ./pi-skill/index.ts
```

## Releases

All npm packages share one version and are released together from the matching `v<version>` Git tag. The publish workflow rejects a tag that does not match the synchronized workspace version.

## License

MIT
