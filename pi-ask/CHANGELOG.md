# Changelog

## 0.2.1

### Patch Changes

- Detect native blocked-question status from the active Pi dialog and retain OSC fallback when unavailable. Verify tool calls and terminal dialogs through real hosts, and correct the configuration package identity.

## 0.2.0

### Minor Changes

- Report an open ask form as blocked in the OSC 7501 program status (built in on Pi 1.5.0+, with a fallback on older Pi) and retire the osc7501 notification channel

## 0.1.0

### Minor Changes

- Add structured ask_user_question flows with OSC 7501 status notifications.
