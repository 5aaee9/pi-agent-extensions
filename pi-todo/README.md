# @indexyz/pi-todo

A repository-owned fork of [`@juicesharp/rpiv-todo` 2.15.0](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo), verified with Pi 1.5.0. It adds a `todo` tool, a
`/todos` command, and a live task panel above the editor. Task state survives
`/reload`, compaction, and detached sessions, while new session records store
compact action records instead of repeating the complete task list on every
call.

The runtime identities from the upstream extension are intentionally preserved:
`todo`, `/todos`, the `rpiv-todo-state` session entry, and the `rpiv-todos`
widget key. Existing sessions can therefore be replayed by the fork.

## Install

```bash
pi install npm:@indexyz/pi-todo
```

Releases are published to npm as `@indexyz/pi-todo`; each release is tagged
`@indexyz/pi-todo@<version>`.

To try the repository checkout for one session (after `npm install` at the
repository root):

```bash
pi -e ./pi-todo/index.ts
```

## Usage

- Ask the agent to track multi-step work; it can call the `todo` tool with
  `create`, `update`, `list`, `get`, `delete`, and `clear` actions.
- Run `/todos` in an interactive session to display all current tasks grouped by
  status.
- Press `ctrl+shift+t` to collapse or expand the live panel. Configure this key
  with `collapseKey` or set it to `off`.

The task model supports statuses, descriptions, active forms, owners,
`blockedBy` dependencies, metadata, batch creation, and session-scoped task
state. The overlay hides completed rows after the current turn and truncates
large lists according to its configured row budget.

### Configuration

The extension reads the existing `rpiv-todo` configuration location:

```text
$XDG_CONFIG_HOME/rpiv-todo/config.json
~/.config/rpiv-todo/config.json
```

Example:

```json
{
  "maxWidgetLines": 8,
  "collapseKey": "alt+t"
}
```

The optional `guidance` field replaces the built-in model instructions. The
optional peer `@juicesharp/rpiv-i18n` enables localized UI strings; without it,
English fallbacks are used.

### Session persistence

New tool results and `rpiv-todo-state` custom entries serialize the action and
parameters needed for replay, not the cumulative `tasks` and `nextId` snapshot.
This applies to both direct calls and nested `ctx.executeTool` calls. Legacy
sessions containing full snapshots remain readable and do not need migration.

## Development

```bash
npm install
npm run check --workspace @indexyz/pi-todo
npm run test:e2e -- --package @indexyz/pi-todo
```

## License

MIT
