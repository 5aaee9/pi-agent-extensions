# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono), and for the [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) coding agent.

## Packages

| Package                                                 | Description                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api) | Dynamic provider support, model metadata discovery, and quota reporting for Sub2API-compatible relays.                       |
| [`@indexyz/pi-custom-provider`](./pi-custom-provider)   | Generic OpenAI Chat Compatible, Anthropic Messages, OpenAI Responses, and Ollama providers with model discovery and caching. |
| [`@indexyz/pi-continue`](./pi-continue)                 | Resume an interrupted or failed turn with pi's currently selected model.                                                     |
| [`@indexyz/pi-skill`](./pi-skill)                       | Codex-style `$skill-name` invocation anywhere in a prompt.                                                                   |
| [`@indexyz/pi-model-trace`](./pi-model-trace)           | Attribute the model actually serving pi via ModelTrace numeric fingerprinting (`/model-trace`).                              |
| [`@indexyz/pi-autocompact`](./pi-autocompact)           | Session-only per-model context compaction thresholds via `/autocompact 300k`, with optional global defaults.                 |
| [`@indexyz/dsh-autocompact`](./dsh-autocompact)         | The same thresholds for dsh: a `/autocompact` command, a Settings section, and a composer status entry.                      |

Install a package from npm:

```bash
pi install npm:@indexyz/pi-provider-sub2api
pi install npm:@indexyz/pi-custom-provider
pi install npm:@indexyz/pi-continue
pi install npm:@indexyz/pi-skill
pi install npm:@indexyz/pi-model-trace
pi install npm:@indexyz/pi-autocompact
```

A `dsh-<topic>/` package is installed into a dsh profile instead, and its command line, configuration, and behavior are documented in its own README:

```bash
dsh plugin --profile web add @indexyz/dsh-autocompact
```

## Releases

Each package is versioned and released independently. A release of one package publishes only that package, and each published version is tagged `@indexyz/<name>@<version>` (for example `@indexyz/pi-skill@0.1.43`) with a GitHub Release carrying that version's changelog section. Every package's history is in its own `CHANGELOG.md`. The release procedure is [`docs/releases.md`](./docs/releases.md).

## Layout

The repository root is a private npm workspace that holds shared tooling and documentation only. Each package lives in its own root-level directory with its own `package.json`, `tsconfig.json`, `vitest.config.ts`, tests, and changelog: `pi-<topic>/` for a pi extension, `dsh-<topic>/` for a dsh package, which builds its own artifacts from TypeScript because the Harness loads built files rather than sources. See [`docs/architecture.md`](./docs/architecture.md).

## Development

```bash
npm install
npm run format
npm run check
pi -e ./pi-provider-sub2api/index.ts
```

`npm run check` runs the format check, lint, every package's typecheck, the build step of every package that declares one, every package's tests, and the release-script tests. Try a pi package from a checkout with `pi -e ./<name>/index.ts`.

Contributors and coding agents start with [`AGENTS.md`](./AGENTS.md), which links the rest of [`docs/`](./docs).

## License

MIT
