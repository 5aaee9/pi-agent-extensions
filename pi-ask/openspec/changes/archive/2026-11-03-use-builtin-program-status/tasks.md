# Tasks

## 1. Pi 1.5.0 upgrade

- [x] 1.1 Bump `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` in `pi-ask/package.json` `devDependencies` from `0.84.0` to `1.5.0`, keep the peer ranges at `"*"`, and run `npm install`. Verify that `pi-ask/node_modules/@earendil-works/pi-coding-agent/package.json` reports `1.5.0` and that `package-lock.json` changes accordingly.
- [x] 1.2 Read the 1.5.0 `CHANGELOG.md` breaking changes, then fix any typecheck or test failures the upgrade causes. Verify that `npm run check --workspace @indexyz/pi-ask` passes.
- [x] 1.3 Add the `pi-ask` row (pinned 1.5.0, its own installed copy) to the pin table in `docs/pi-reference.md`, and verify the row matches `pi-ask/package.json`.

## 2. Program status reporting

- [x] 2.1 Add `src/program-status.ts` with the host version gate and Pi-format root record formatting (`blocked`/`working`/`idle`, `app=pi`, base64 `msg`, `ESC \` terminator), and list it in `files` if needed (`src/` is already listed). Verify with unit tests for version comparison (`1.4.0` false, `1.5.0`/`1.10.0`/`2.0.0` true, garbage false) and for exact sequence bytes, including message sanitizing and the 2048-byte limit.
- [x] 2.2 Add the resting-status tracker to `src/program-status.ts` and subscribe it in `index.ts` to `session_start`, `agent_start`, `message_end`, `agent_settled`, and `session_compact`. Verify with unit tests that feed event sequences: a normal run leads to `done`; a run whose final assistant message has `stopReason: "error"` leads to `error` with the first line of `errorMessage`; an error followed by a normal message leads to `done`; an aborted run leads to `idle`; a new session leads to `idle`; a compaction outside a run leads to `done`.
- [x] 2.3 In `runAskFlow` (`src/ui/controller.ts`), always pass `blocked: { kind: "question", message }` to `ctx.ui.custom`. On unsupported hosts, write the fallback `blocked` record when the flow opens, and the restore record exactly once when it closes: `working` with the session name when not idle, the tracked resting status otherwise. Skip both when stdout is not a TTY or `PI_PROGRAM_STATUS=0`. Verify with tests that capture the `custom()` options and stdout writes for both host paths, and for the `working`, `done`, `error`, and `idle` restores.
- [x] 2.4 Document in `pi-ask/README.md` how an open form is reported (built-in on Pi ≥ 1.5.0, fallback with restored status on older hosts, `PI_PROGRAM_STATUS=0` to disable, the compaction-failure limitation), and update the `package.json` description. Verify that the README matches the tests from 2.2 and 2.3.

## 3. Retire the osc7501 channel

- [x] 3.1 Remove the `osc7501` case from `src/notifications.ts` and from the runtime `AskNotificationChannel` type, and change the default channels to `["bell"]`. Verify with updated `test/notifications.test.ts` cases (default is `["bell"]`; redirected stdout skips only `bell`).
- [x] 3.2 Keep accepting `"osc7501"` in the file schema, and drop it in `normalizeNotificationChannels`, falling back to `["bell"]` when nothing else remains. Verify with config tests: `["bell", "osc7501"]` loads without a notice and normalizes to `["bell"]`; `["osc7501"]` normalizes to `["bell"]`; the file on disk is unchanged.
- [x] 3.3 Update `pi-ask/docs/configuration.md` (channel list, default, retired value, pointer to the README's program status section). Verify that nothing documents `osc7501` as a working channel: `rg -n osc7501 pi-ask --glob '!openspec/**' --glob '!CHANGELOG.md'` should only hit the schema compatibility code, its tests, and the retired-value note.

## 4. Verification and release decision

- [x] 4.1 Record a minor release intent: `npm run change -- --minor @indexyz/pi-ask -m "Report waiting questions as blocked in the OSC 7501 program status and retire the osc7501 channel"`. Verify that `npm run change:status` lists it.
- [x] 4.2 Run `npm run check` from the repository root and verify that it passes. Result: format, lint, typecheck, build, the release-script tests, and every pi-ask test pass. The remaining failures happen on an unmodified `HEAD` checkout on this machine too and have nothing to do with this change: one `pi-custom-provider` test, and the dsh client-plane tests, whose dsh host cannot be prepared here. CI runs the same check on `main` and it passes there.
- [x] 4.3 Run the RPC load smoke test with the package's own binary (`printf '{"id":"1","type":"get_commands"}\n' | pi-ask/node_modules/.bin/pi -ne -e ./pi-ask/index.ts --mode rpc`) and `npm run test:e2e -- --package @indexyz/pi-ask`. Verify `"success":true` and exit code 0.
- [x] 4.4 Check live with `PI_PROGRAM_STATUS=1`, triggering `ask_user_question` under both hosts: Pi 1.5.0 (`pi-ask/node_modules/.bin/pi -e ./pi-ask/index.ts`) and the installed Pi 1.4.0 (`pi -e ./pi-ask/index.ts`). Record the terminal output (for example with `script`). Verify that it shows `state=blocked:app=pi:kind=question` while the form is open and `state=working:app=pi` after it closes during a run. On 1.4.0, also open the form with `/answer` after a completed run, and verify that it restores `state=done:app=pi`.

## Workflow follow-up

- Archive `use-builtin-program-status` after review, then commit as `feat(ask): ...`.
