# Pi reference

Pi's own documentation, examples, and type declarations are the source of truth for its API. They ship inside the host package `@earendil-works/pi-coding-agent`, which every package installs as a pinned dev dependency, so the installed copy matches the version that package targets.

## Which copy to read

Packages pin their Pi version independently. After `npm install`:

| Package               | Pinned Pi | Installed copy                                                 |
| --------------------- | --------- | -------------------------------------------------------------- |
| `pi-provider-sub2api` | 0.84.0    | `node_modules/@earendil-works/pi-coding-agent/`                |
| `pi-custom-provider`  | 0.84.0    | `node_modules/@earendil-works/pi-coding-agent/`                |
| `pi-continue`         | 0.84.0    | `node_modules/@earendil-works/pi-coding-agent/`                |
| `pi-skill`            | 0.84.0    | `node_modules/@earendil-works/pi-coding-agent/`                |
| `pi-model-trace`      | 0.84.0    | `node_modules/@earendil-works/pi-coding-agent/`                |
| `pi-autocompact`      | 0.87.1    | `pi-autocompact/node_modules/@earendil-works/pi-coding-agent/` |

The rule behind the table: when a package pins a different version than most of the workspace, npm installs that version inside the package's own `node_modules/`; otherwise the package uses the root copy. Check the `devDependencies` of the package you edit, and read the copy at that version. The matching `pi` binary is in the `node_modules/.bin/` next to it (`docs/workflow.md`, "Verify"). Update this table when a pin changes.

## Layout of the installed package

```
@earendil-works/pi-coding-agent/
├── docs/            Markdown documentation (the set of files differs between versions)
├── examples/
│   ├── extensions/  checked extension examples with a README index
│   └── sdk/         programmatic usage
├── dist/index.d.ts  exported types (ExtensionAPI, ExtensionContext, events)
└── CHANGELOG.md     breaking changes per version
```

Read a doc completely and follow its cross-references before using an API from it. Do not rely on memory of Pi's API: names and contracts change between versions. List `docs/` of the copy you are reading to see which documents exist at that version.

## Which doc for which task

| Task                                                               | Read                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Any extension work: lifecycle, events, commands, state, UI, errors | `docs/extensions.md`                                             |
| Package manifest, dependencies, install sources                    | `docs/packages.md`                                               |
| Custom terminal components, footer, themes, input                  | `docs/tui.md`, then `docs/themes.md`                             |
| Adding a model provider, model metadata                            | `docs/custom-provider.md`, `docs/providers.md`, `docs/models.md` |
| Compaction hooks                                                   | `docs/compaction.md`                                             |
| Session entry shapes                                               | `docs/session-format.md`, `docs/sessions.md`                     |
| Skills and prompt templates                                        | `docs/skills.md`, `docs/prompt-templates.md`                     |
| Non-interactive modes (print, JSON, RPC) an extension must survive | `docs/json.md`, `docs/rpc.md`                                    |
| Settings, environment variables, and resource paths                | `docs/settings.md`, `docs/environment-variables.md`              |

## Looking up a type

```bash
grep -rn "interface ExtensionAPI" --include="*.d.ts" node_modules/@earendil-works/pi-coding-agent/dist/
```

`dist/index.d.ts` re-exports the public types from modules under `dist/` (extension types are in `dist/core/extensions/types.d.ts` in 0.84.0); search for the symbol rather than reading the files top to bottom. Event payloads and return types are declared next to the event name.

## Contracts that are easy to get wrong

From `docs/extensions.md`; the doc has the full rules for the version you target.

- The factory may run in invocations that never start a session. Start background resources on `session_start` or in the command that needs them, and close them in an idempotent `session_shutdown` handler.
- An async factory is awaited before `session_start` and before queued `pi.registerProvider()` registrations are flushed.
- Reconstruct branch-sensitive state from the session branch, not from every entry in the session file.
