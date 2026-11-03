# Design

## Context

The ask form opens through `ctx.ui.custom()` in `runAskFlow` (`src/ui/controller.ts`). Every interactive question takes this path: the tool, `/answer`, replay, and pending-ask recovery. The same function starts the notification channels from `src/notifications.ts`. Today the `osc7501` channel there writes a child record (`id=pi-ask/<n>`), which terminals do not show in place of the root record.

Pi's reporting by version:

- **0.84.0**: no OSC 7501.
- **1.4.0**: Pi writes the root record (`app=pi`, terminated by `ESC \`). It reports `working` with the session name during a run, and `blocked` only for built-in dialogs and login. It re-sends a report only when its computed status changes. Its `ProgramStatusReporter` computes the resting status like this. `agent_start` sets the run result to `done`. Each assistant `message_end` sets it to `error`, with the first line of `errorMessage`, when `stopReason` is `"error"`, and to `done` otherwise. `agent_settled` makes the resting status `idle` when aborted, and the run result otherwise. A finished manual compaction sets `done` or `error`. A session reset sets `idle`. `done` and `working` carry the session name.
- **1.5.0**: inline `ctx.ui.custom()` accepts `blocked: { kind, message }`. Pi reports `blocked` while the component is shown and its computed status afterwards.

The extension imports `VERSION` from `@earendil-works/pi-coding-agent`. Pi's loader maps that import to the host's own copy, so the value is the running Pi's version.

## Goals / Non-Goals

**Goals:**

- Show `blocked` instead of `working` while an ask form is open, on Pi 1.5.0 and on older hosts.
- Keep existing `pi-ask.json` files loading cleanly.

**Non-Goals:**

- Report status for `/ask-settings` or the `/answer` extraction loader.
- Show the ask form as an overlay, where Pi ignores `blocked`.
- Bump the config schema version or add a migration.
- Track compaction failures or aborts outside a run. Extensions get no event for them.

## Decisions

- **Choose the path by host version.** A new module (`src/program-status.ts`) exposes `supportsCustomBlocked(version)`. It returns true for `VERSION` 1.5.0 or newer, comparing numeric major/minor/patch. An unparseable version counts as unsupported, so the fallback runs. Alternative: feature-detect at runtime by passing the option and observing output. Rejected, because the option is silently ignored and nothing can be observed.
- **Built-in path.** `runAskFlow` passes `{ blocked: { kind: "question", message } }` to `ctx.ui.custom` on every host. Older hosts ignore it, so the call stays uniform. The message comes from `createQuestionWaitingNotification` for the first question, the same text the bell and other channels use.
- **Fallback path.** On unsupported hosts, the module writes the root record when the controller is created, and the restore record when `dispose` or `maybeFinish` runs (whichever comes first; it is idempotent). The format copies Pi's `formatProgramStatus`: pairs `state`, `app=pi`, `kind` (only for `blocked`), and `msg` (base64 UTF-8, control characters replaced by spaces, at most 2048 bytes), joined with `:` and terminated with `ESC \`. Using `app=pi` and no `id` makes the record look exactly like Pi's, so terminals treat it as the session's status. Pi 1.4.0 does not re-send its own report until its status changes, so without this restore the terminal would stay `blocked`.
- **Restore what Pi would report.** When `ctx.isIdle()` is false, the restore record is `working` with `ctx.sessionManager.getSessionName()` as the message. Otherwise it is the tracked resting status. A small tracker in the program-status module mirrors Pi's rules (see Context). `index.ts` subscribes it to `session_start` (reset to `idle`), `agent_start`, `message_end` (assistant messages only), `agent_settled` (uses `aborted`), and `session_compact` (`done` when no run is active). All of these exist in the 1.4.0 extension API. The tracker keeps the run result and the resting status separately, as Pi does, so an error in an early message is replaced by a later normal one. The subscriptions are cheap, and they are registered on every host so behavior does not depend on load order. Only the fallback reads them. `done` carries the session name read at restore time, like Pi. Alternative: always restore `idle`. Rejected, because it showed the wrong status after every completed or failed run.
- **Gate the fallback on TTY and `PI_PROGRAM_STATUS`.** It writes only when `process.stdout.isTTY` and `PI_PROGRAM_STATUS !== "0"`. pi-ask cannot see the terminal's reply to Pi's support query, so it relies on terminals ignoring unknown OSC sequences, as the old channel did.
- **Remove the `osc7501` notification channel.** Status reporting is now automatic and independent of notification settings. A configurable channel would duplicate or contradict it. The user chose removal.
- **Treat `osc7501` as a retired value instead of migrating.** The file schema (`validateAskConfigFileV5`) still accepts the literal, so existing files are not reported as invalid. `normalizeNotificationChannels` drops it, and the runtime `AskNotificationChannel` type no longer contains it. With no valid channels left, the code falls back to the new default `["bell"]`. Alternative: a v5→v6 migration. Rejected, because it renames the V5 types and helpers throughout for a single dropped value.
- **Upgrade all three `@earendil-works/*` dev pins to 1.5.0 together** (`docs/workflow.md`, "Upgrade Pi"), so `blocked` typechecks without a cast. pi-ask's tool schema uses only plain TypeBox object, string, array, union, and literal types, none of the features the 1.5.0 pi-schema change calls out. The package then gets its own `pi-ask/node_modules/` copy and `pi` binary, and a row in `docs/pi-reference.md`.

## Risks / Trade-offs

- [A manual compaction outside a run that fails or is aborted leaves the tracked status unchanged, while Pi reports `error` or `idle`] → No extension event reports it. It only matters if a form opens and closes before Pi's next status change, which then corrects it.
- [The tracker drifts if Pi changes its rules] → It applies only to hosts before 1.5.0, whose rules are fixed. Pi 1.5.0 and later restore their own status.
- [The fallback writes to a terminal that never answered Pi's support query] → Unknown OSC sequences are ignored by conforming terminals, `PI_PROGRAM_STATUS=0` turns it off, and the old channel had the same exposure.
- [A Pi status change while the form is open (for example compaction) overwrites the fallback's `blocked`] → Acceptable. Pi's report is authoritative, and the restore on close still runs.
- [`VERSION` would come from pi-ask's own copy if the host stopped aliasing the import] → Pi's loader aliases it today, and the version gate fails safe to the fallback.

## Migration Plan

No user action is needed. Existing configurations keep loading, and an `osc7501` entry has no effect. Rolling back means reverting the change; the 0.1.0 release keeps the old behavior.
