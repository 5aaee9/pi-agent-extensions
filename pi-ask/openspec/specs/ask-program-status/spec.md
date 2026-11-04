# ask-program-status Specification

## Purpose

Reports to the terminal that pi is waiting on the user while an ask form is open, using the OSC 7501 program status root record. Also defines which notification channels pi-ask still emits.

## Requirements

### Requirement: Report an open ask form through Pi's built-in status

On a Pi host that supports a `blocked` option for custom components (detected from its handling of the option, independent of its version string), the extension SHALL open the ask form with that option set to `kind=question` and a single-line message naming the waiting question. In that case it SHALL NOT write OSC 7501 sequences itself.

#### Scenario: Question waiting on Pi 1.5.0

- **WHEN** the agent calls `ask_user_question` in interactive TUI mode on a host with native support
- **THEN** Pi reports `state=blocked` with `kind=question` and a message of the form "Question waiting: <label or prompt>" until the form closes, and pi-ask writes no OSC 7501 sequence

#### Scenario: Form closed on Pi 1.5.0

- **WHEN** the user submits, cancels, or dismisses the ask form
- **THEN** Pi reports its own status again, for example `working` while the agent continues

### Requirement: Write the root status record on older hosts

On a Pi host without the `blocked` option, the extension SHALL write an OSC 7501 root record without an `id`, in Pi's format (`app=pi`), with `state=blocked`, `kind=question`, and the base64 message when the form opens. When the form closes, it SHALL write the status Pi would report at that point.

#### Scenario: Question waiting during an agent run on an older host

- **WHEN** the agent calls `ask_user_question` on a host without native support
- **THEN** stdout receives `ESC ] 7501 ; state=blocked:app=pi:kind=question:msg=<base64> ESC \` when the form opens

#### Scenario: Form closed while the agent run continues

- **WHEN** the form closes and the agent is not idle
- **THEN** stdout receives a root `state=working:app=pi` record carrying the session name as `msg` when the session has a name

#### Scenario: Form closed after a completed run

- **WHEN** the form, opened from a command or replay, closes while the agent is idle and the last run ended normally
- **THEN** stdout receives a root `state=done:app=pi` record carrying the session name as `msg` when the session has a name

#### Scenario: Form closed after a failed run

- **WHEN** the form closes while the agent is idle and the last run's final assistant message stopped with an error
- **THEN** stdout receives a root `state=error:app=pi` record whose `msg` is the first line of that error message

#### Scenario: Form closed after an aborted run or in a fresh session

- **WHEN** the form closes while the agent is idle and the last run was aborted, or no run has happened since the session started
- **THEN** stdout receives a root `state=idle:app=pi` record

#### Scenario: Form closed after a manual compaction

- **WHEN** the form closes while the agent is idle and the most recent status change was a successful compaction outside a run
- **THEN** stdout receives a root `state=done:app=pi` record

#### Scenario: Reporting disabled or unavailable

- **WHEN** stdout is not a TTY or `PI_PROGRAM_STATUS` is `0`
- **THEN** the extension writes no OSC 7501 sequence

#### Scenario: Host version does not predict its capability

- **WHEN** a host consumes the native blocked option even though its version string differs from standard Pi releases
- **THEN** the host manages status and pi-ask emits no fallback OSC sequence

#### Scenario: Form construction fails before display

- **WHEN** custom UI fails before the form is rendered
- **THEN** the extension does not emit a fallback blocked status

### Requirement: Retire the osc7501 notification channel

New configurations SHALL default to the `bell` notification channel only. In an existing configuration, an `osc7501` channel entry SHALL be ignored without marking the configuration invalid and without rewriting the file. Program status reporting does not depend on notification settings.

#### Scenario: Existing configuration lists osc7501

- **WHEN** `pi-ask.json` lists `["bell", "osc7501"]` as notification channels
- **THEN** the extension loads it without an invalid-configuration notice, emits only the bell as a notification, and leaves the file unchanged

#### Scenario: osc7501 was the only channel

- **WHEN** `pi-ask.json` lists only `["osc7501"]`
- **THEN** the extension falls back to the default `["bell"]` channels

#### Scenario: New configuration

- **WHEN** pi-ask creates a default `pi-ask.json`
- **THEN** the notification channels are `["bell"]`
