# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

## Packages

- [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api) — dynamic provider support, model metadata discovery, and quota reporting for Sub2API-compatible relays.
- [`@indexyz/pi-continue`](./pi-continue) — resume an interrupted or failed turn with pi's currently selected model.

The repository root is a private npm workspace. Install packages from npm with:

```bash
pi install npm:@indexyz/pi-provider-sub2api
pi install npm:@indexyz/pi-continue
```

For local development:

```bash
npm install
npm run format
npm run lint
npm run check
pi -e ./pi-provider-sub2api/index.ts
pi -e ./pi-continue/index.ts
```

## Releases

Both npm packages share one version and are released together from the matching `v<version>` Git tag. The publish workflow rejects a tag that does not match the synchronized workspace version.

## License

MIT
