# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono), and for the [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) coding agent.

## Packages

| Package                                                                                     | Description                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api)                                     | Dynamic provider support, cached model discovery, quota reporting, saved request modes, and Grok (xAI) entries for Sub2API-compatible relays. |
| [`@indexyz/pi-custom-provider`](./pi-custom-provider)                                       | Generic OpenAI Chat Compatible, Anthropic Messages, OpenAI Responses, and Ollama providers with model discovery and caching.                  |
| [`@indexyz/pi-continue`](./pi-continue)                                                     | Resume an interrupted or failed turn with pi's currently selected model.                                                                      |
| [`@indexyz/pi-skill`](./pi-skill)                                                           | Codex-style `$skill-name` invocation anywhere in a prompt.                                                                                    |
| [`@indexyz/pi-model-trace`](./pi-model-trace)                                               | Attribute the model actually serving pi via ModelTrace numeric fingerprinting (`/model-trace`).                                               |
| [`@indexyz/pi-autocompact`](./pi-autocompact)                                               | Per-model context compaction thresholds via `/autocompact 300k`, with `--save` to persist a user-level default.                               |
| [`@indexyz/dsh-autocompact`](./dsh-autocompact)                                             | The same thresholds for dsh: a `/autocompact` command, a Settings section, and a composer status entry.                                       |
| [`@indexyz/dsh-custom-provider-reasoning-efforts`](./dsh-custom-provider-reasoning-efforts) | Declare `reasoningEfforts` and `input` modalities for hand-written dsh provider routes the pi-ai catalog does not describe.                   |
| [`@indexyz/dsh-thread-summary`](./dsh-thread-summary)                                       | Generate a concise session title from the first user prompt with a configurable summary model.                                                |
| [`@indexyz/dsh-prompt-suggestions`](./dsh-prompt-suggestions)                               | Suggest the user's next message as dim ghost text in an empty composer after a successful reply.                                              |

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
dsh plugin --profile web add @indexyz/dsh-thread-summary
dsh plugin --profile web add @indexyz/dsh-prompt-suggestions
```

## Releases

Each package is versioned and released independently. A release of one package publishes only that package, and each published version is tagged `@indexyz/<name>@<version>` (for example `@indexyz/pi-skill@0.1.43`) with a GitHub Release carrying that version's changelog section. Every package's history is in its own `CHANGELOG.md`. The release procedure is [`docs/releases.md`](./docs/releases.md).

Every new npm package starts with an independent empty `0.0.0` workspace: the owner publishes it with the `bootstrap` tag and configures npm Trusted Publisher before the formal version is pushed to GitHub for CI publication. Follow [First release of a new package](./docs/releases.md#first-release-of-a-new-package) for the workspace template, commands and publisher settings.

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

Dsh build output (`lib/` and optional `client.js`) is Git-ignored; `npm pack` builds and includes it automatically. Before installing a dsh checkout into a profile, run `npm run build --workspace @indexyz/<name>`, then `dsh plugin --profile web add ./<name>`.

OpenSpec is installed with the repository tooling. Run `npx openspec <command>` from the repository root for shared changes, or from a package directory for changes to that package.

Contributors and coding agents start with [`AGENTS.md`](./AGENTS.md), which links the rest of [`docs/`](./docs).

## License

MIT
