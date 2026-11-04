# Changelog

## 0.2.2

### Patch Changes

- `/answer` now falls back to the chat model when the configured extraction models have no credentials, where it previously failed with `Provider is not configured`. The settings overlay and configuration docs name `@indexyz/pi-ask`.
- With auto-submit on, answering with a number key now submits the form, as confirming with Enter already did.

## 0.2.1

### Patch Changes

- Detect native blocked-question status from the active Pi dialog and retain OSC fallback when unavailable. Verify tool calls and terminal dialogs through real hosts, and correct the configuration package identity.

## 0.2.0

### Minor Changes

- Report an open ask form as blocked in the OSC 7501 program status (built in on Pi 1.5.0+, with a fallback on older Pi) and retire the osc7501 notification channel

## 0.1.0

### Minor Changes

- Add structured ask_user_question flows with OSC 7501 status notifications.
