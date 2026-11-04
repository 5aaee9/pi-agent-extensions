# pi-agent-extensions

A collection of extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono), and for the [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) coding agent.

## Packages

All eight Pi packages are verified against Pi 1.5.0. `pi-ask` also exercises its OSC status fallback on Pi 1.4.0.

| Package                                                                                     | Description                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@indexyz/pi-provider-sub2api`](./pi-provider-sub2api)                                     | Dynamic provider support, cached model and price discovery, quota reporting, saved request modes, and Grok (xAI) entries for Sub2API-compatible relays.      |
| [`@indexyz/pi-custom-provider`](./pi-custom-provider)                                       | Generic OpenAI Chat Compatible, Anthropic Messages, OpenAI Responses, and Ollama providers with model discovery, caching, and transcript-aware Ollama tools. |
| [`@indexyz/pi-continue`](./pi-continue)                                                     | Resume an interrupted or failed turn with pi's currently selected model.                                                                                     |
| [`@indexyz/pi-skill`](./pi-skill)                                                           | Codex-style `$skill-name` invocation anywhere in a prompt.                                                                                                   |
| [`@indexyz/pi-model-trace`](./pi-model-trace)                                               | Attribute the model actually serving pi via ModelTrace numeric fingerprinting in isolated sessions of the current host (`/model-trace`).                     |
| [`@indexyz/pi-autocompact`](./pi-autocompact)                                               | Context compaction thresholds via `/autocompact 300k` or `80%`, with per-model defaults and provider and global caps.                                        |
| [`@indexyz/pi-idle-compression`](./pi-idle-compression)                                     | Compact a session's context automatically after it has been idle (default 50 minutes), configurable globally, per provider, and per model.                   |
| [`@indexyz/pi-ask`](./pi-ask)                                                               | Structured clarification questions with replay, recovery, and native OSC status detection with a fallback.                                                   |
| [`@indexyz/dsh-autocompact`](./dsh-autocompact)                                             | The same thresholds for dsh: a `/autocompact` command, a Settings section, and a composer status entry.                                                      |
| [`@indexyz/dsh-custom-provider-reasoning-efforts`](./dsh-custom-provider-reasoning-efforts) | Declare `reasoningEfforts` and `input` modalities for hand-written dsh provider routes the pi-ai catalog does not describe.                                  |
| [`@indexyz/dsh-thread-summary`](./dsh-thread-summary)                                       | Generate a concise session title from the first user prompt with a configurable summary model.                                                               |
| [`@indexyz/dsh-prompt-suggestions`](./dsh-prompt-suggestions)                               | Suggest the user's next message as dim ghost text in an empty composer after a successful reply.                                                             |

Install a package from npm:

```bash
pi install npm:@indexyz/pi-provider-sub2api
pi install npm:@indexyz/pi-custom-provider
pi install npm:@indexyz/pi-continue
pi install npm:@indexyz/pi-skill
pi install npm:@indexyz/pi-model-trace
pi install npm:@indexyz/pi-autocompact
pi install npm:@indexyz/pi-idle-compression
pi install npm:@indexyz/pi-ask
```

A `dsh-<topic>/` package is installed into a dsh profile instead, and its command line, configuration, and behavior are documented in its own README:

```bash
dsh plugin --profile web add @indexyz/dsh-autocompact
dsh plugin --profile web add @indexyz/dsh-custom-provider-reasoning-efforts
dsh plugin --profile web add @indexyz/dsh-thread-summary
dsh plugin --profile web add @indexyz/dsh-prompt-suggestions
```

## Releases

Each package is versioned and released independently. A release of one package publishes only that package, and each published version is tagged `@indexyz/<name>@<version>` (for example `@indexyz/pi-skill@0.1.43`) with a GitHub Release carrying that version's changelog section. Every package's history is in its own `CHANGELOG.md`. The release procedure is [`docs/releases.md`](./docs/releases.md).

Every new npm package starts with an independent empty `0.0.0` workspace: the owner publishes it with the `bootstrap` tag and configures npm Trusted Publisher before the formal version is pushed to GitHub for CI publication. Follow [First release of a new package](./docs/releases/first-release.md) for the workspace template, commands and publisher settings.

## Layout

The repository root is a private npm workspace that holds shared tooling and documentation only. Each package lives in its own root-level directory with its own `package.json`, `tsconfig.json`, `vitest.config.ts`, tests, and changelog: `pi-<topic>/` for a pi extension, `dsh-<topic>/` for a dsh package, which builds its own artifacts from TypeScript because the Harness loads built files rather than sources. See [`docs/architecture.md`](./docs/architecture.md).

## Development

Pi and dsh packages are separate plugin systems, so work on one package verifies only that package:

```bash
npm install
npx oxfmt --check <name> .changeset
npx oxlint --deny-warnings <name>
npm run check --workspace @indexyz/<name>
npm run test:e2e -- --package @indexyz/<name>
```

A pi package also runs its black-box scenarios with `node --test "scripts/e2e/pi/<name>*.e2e.ts"`, and the whole Pi suite with `npm run test:e2e:pi`; try it from a checkout with `pi -e ./<name>/index.ts`. A dsh package also needs `pnpm` and `npx playwright install chromium`. Root `npm run check` and `npm run test:e2e` cover every package in both systems; CI runs them, and they are the gate for changes to shared tooling.

Dsh build output (`lib/` and optional `client.js`) is Git-ignored; `npm pack` builds and includes it automatically. Before installing a dsh checkout into a profile, run `npm run build --workspace @indexyz/<name>`, then `dsh plugin --profile web add ./<name>`.

OpenSpec is installed with the repository tooling. Run `npx openspec <command>` from the repository root for shared changes, or from a package directory for changes to that package.

Contributors and coding agents start with [`AGENTS.md`](./AGENTS.md), which links the rest of [`docs/`](./docs).

## License

MIT
