# Proposal

## Why

pi-ask writes its own OSC 7501 report while a question waits, but terminals still show the session as `working`. The report is a separate child record (`id=pi-ask/<n>`). Terminals display the root record, which Pi owns and keeps at `working` for the whole agent run, because `ctx.ui.custom()` dialogs do not count as blocking. Pi 1.5.0 adds a `blocked` option to inline `ctx.ui.custom()` components, so Pi's own reporter can mark the session `blocked` while the form is open and restore it afterwards. On older Pi hosts, pi-ask has to write the root record itself.

## What Changes

- Pin `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` dev dependencies to `1.5.0` (from `0.84.0`) and fix anything the upgrade breaks.
- On Pi 1.5.0 and later, open the interactive ask form through `ctx.ui.custom(..., { blocked: { kind: "question", message } })`. Pi then reports `blocked` with `kind=question` while the form is visible, and its previous status when the form closes. The message is the existing "Question waiting: <label>" text.
- On older Pi hosts, pi-ask writes the root record itself in Pi's format: `state=blocked:app=pi:kind=question:msg=<base64>` when the form opens. When the form closes, it writes the status Pi would report at that point. While an agent run is active, that is `working` with the session name. Otherwise it is the resting status pi-ask tracks from the same events Pi uses: `done` with the session name, `error` with the first line of the error, or `idle`. It writes nothing when stdout is not a TTY or `PI_PROGRAM_STATUS=0`.
- **BREAKING (configuration)**: remove the `osc7501` notification channel, because status reporting is no longer a configurable notification. New configurations default to `["bell"]`. In an existing `pi-ask.json`, an `osc7501` entry is accepted but ignored: the file is not marked invalid and not rewritten. If `osc7501` was the only channel, pi-ask falls back to the default.
- Update the README, configuration docs, and package description.

## Capabilities

### New Capabilities

- `ask-program-status`: How an open ask form is reported as a `blocked` question in the OSC 7501 program status: through Pi's built-in reporter when available, through a fallback otherwise. Also covers which notification channels pi-ask still emits.

### Modified Capabilities

<!-- None: openspec/specs/ has no archived capability yet (add-pi-ask is still an open change and has no notification requirement). -->

## Impact

- Code: `src/ui/controller.ts` (the `ctx.ui.custom` call and the fallback lifetime), a new program-status module for host detection, resting-status tracking, and fallback sequences, event subscriptions in `index.ts`, `src/notifications.ts` (drop the `osc7501` case), `src/config/schema.ts` and `src/config/defaults.ts` (channel type, default, and the retired value), and tests under `test/`.
- Dependencies: `pi-ask/package.json` dev dependency pins, `package-lock.json`, and the pin table in `docs/pi-reference.md`. Peer ranges stay `"*"`.
- Docs: `pi-ask/README.md`, `pi-ask/docs/configuration.md`, and the `package.json` description.
- Release: published files change, so the change needs a minor release intent for `@indexyz/pi-ask`, which is still at 0.x.
