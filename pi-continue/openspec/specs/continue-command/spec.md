# continue-command Specification

## Purpose

Define how `/continue` retries an interrupted or failed turn, in every mode Pi can run a command in.

## Requirements

### Requirement: Continue retries in every mode

`/continue` SHALL perform the retried model turn before its command completes, so print and JSON runs do not exit before the turn happens.

#### Scenario: Print mode retries a failed turn

- **WHEN** `pi -p /continue` runs on a session whose last turn failed
- **THEN** one model request is sent, the retried reply is printed, and the process exits 0

#### Scenario: JSON mode retries a failed turn

- **WHEN** `pi --mode json /continue` runs on a session whose last turn failed
- **THEN** one model request is sent, the retried reply is in the event stream, and the process exits 0

### Requirement: The retry marker never reaches a provider

The hidden message `/continue` uses to start a turn SHALL be removed before every model call, so no provider receives an empty message for it.

#### Scenario: A provider adapter keeps empty user messages

- **WHEN** `/continue` retries a failed turn on `ollama-chat`
- **THEN** the request carries only the original user message

### Requirement: A shortcut retries the interrupted turn

The extension SHALL register `f5` and `alt+r` as shortcuts that retry the interrupted or
failed turn the same way `/continue` does, so the retry needs no typed command.

#### Scenario: F5 retries a failed turn

- **WHEN** the session's last turn failed and `F5` is pressed in a terminal
- **THEN** one model request is sent from the preceding user message and the retried reply is shown

#### Scenario: Alt+R retries a failed turn

- **WHEN** the session's last turn failed and `Alt+R` is pressed in a terminal
- **THEN** one model request is sent from the preceding user message and the retried reply is shown

#### Scenario: A shortcut on a completed turn starts nothing

- **WHEN** the session's last turn completed and a shortcut is pressed
- **THEN** no model request is sent and the command's "No interrupted or failed turn" notice appears
