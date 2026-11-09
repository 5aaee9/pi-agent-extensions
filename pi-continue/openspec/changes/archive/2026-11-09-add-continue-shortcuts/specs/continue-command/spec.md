# Spec Delta

## ADDED Requirements

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
