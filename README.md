# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

## Packages

- [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api) — dynamic provider support, model metadata discovery, and quota reporting for Sub2API-compatible relays.
- [`@indexyz/pi-continue`](./pi-continue) — resume an interrupted turn with pi's currently selected model.

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

## License

MIT
