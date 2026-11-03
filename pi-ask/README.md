# @indexyz/pi-ask

Structured clarification questions for Pi, based on [eko24ive/pi-ask](https://github.com/eko24ive/pi-ask) v1.2.0 (commit `49482b7e5d0d57be8af1db81f490f6e860792cfb`). The upstream MIT license is preserved.

## Install

```bash
pi install npm:@indexyz/pi-ask
```

For a repository checkout, after `npm install`:

```bash
pi -e ./pi-ask/index.ts
```

Tested against Pi 0.84.0. Releases use tags `@indexyz/pi-ask@<version>`.

## Usage

The agent calls `ask_user_question` to open tabbed single-select, multi-select, or preview questions. Each question supports a custom answer, question notes, and option notes. Review answers before submitting, request elaboration, or cancel. Unanswered questions do not block submission.

Commands:

- `/answer`: extract questions from the latest completed assistant message using a configured model.
- `/answer:again`: reopen the latest extracted form on the current branch.
- `/ask:replay`: reopen the latest tool form on the current branch.
- `/ask-settings`: configure behavior and notifications; `?` opens the same settings while asking.

Unresolved tool forms can recover on session startup, resume, or fork. Non-TUI modes return a cancelled result rather than opening custom UI.

See [tool contract](docs/contract.md), [configuration](docs/configuration.md), and [local extension events](docs/remote-events.md) for detailed behavior.

## Configuration

Configuration lives at `~/.pi/agent/pi-ask.json`, or `<PI_CODING_AGENT_DIR>/pi-ask.json` when that variable is set. The file is created with defaults on first use. Upstream configuration paths are not read automatically. Existing schema versions migrate in memory without rewriting the file on load.

New configurations enable `bell` and `osc7501` notification channels. Explicit user channel selections are preserved. Terminal notifications are skipped when stdout is not a TTY. OSC 7501 reports `blocked` with `kind=question` using a distinct record per flow; completing or disposing the flow clears that record without clearing unrelated terminal status. Unsupported terminals ignore the sequence.

The renamed tool does not register an `ask_user` alias. Do not load both forks together: commands and local event identifiers are shared with upstream.

## Development

```bash
npm run check --workspace @indexyz/pi-ask
npm run test:e2e -- --package @indexyz/pi-ask
```

## License

MIT; derived from eko24ive/pi-ask. See LICENSE.
