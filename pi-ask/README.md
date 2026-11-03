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

New configurations enable the `bell` notification channel. Explicit user channel selections are preserved. Terminal notifications are skipped when stdout is not a TTY. The retired `osc7501` channel is ignored when an existing configuration lists it; program status is reported automatically instead (below).

## Program status

While an ask form is open, terminals and agent dashboards that support the [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status) see Pi as `blocked` with `kind=question` and the message `Question waiting: <label or prompt>`, instead of `working`. This does not depend on notification settings.

- Pi 1.5.0 and later report it themselves: pi-ask opens the form with the `blocked` option of `ctx.ui.custom()`, and Pi restores its own status when the form closes.
- On older Pi versions, pi-ask writes the same root record Pi writes (`app=pi`, no `id`) when the form opens. When it closes, pi-ask writes the status Pi would report: `working` with the session name during an agent run, otherwise `done`, `error`, or `idle` according to how the last run ended. A failed or aborted manual `/compact` outside a run is not visible to extensions, so the restored status can differ from Pi's until Pi's next status change.
- On older Pi versions, pi-ask writes nothing when stdout is not a TTY or `PI_PROGRAM_STATUS=0`. Pi 1.5.0 and later apply their own `PI_PROGRAM_STATUS` and support detection.

The renamed tool does not register an `ask_user` alias. Do not load both forks together: commands and local event identifiers are shared with upstream.

## Development

```bash
npm run check --workspace @indexyz/pi-ask
npm run test:e2e -- --package @indexyz/pi-ask
```

## License

MIT; derived from eko24ive/pi-ask. See LICENSE.
