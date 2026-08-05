# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

## Packages

- [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api) — dynamic provider support for Sub2API-compatible relays.

The repository root is a private npm workspace. Install the provider from npm with:

```bash
pi install npm:@indexyz/pi-provider-sub2api
```

For local development:

```bash
npm install
npm run check
pi -e ./pi-provider-sub2api/index.ts
```

## License

MIT
