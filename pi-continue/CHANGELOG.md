# Changelog

## 0.1.21 - 2026-08-30

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.20 - 2026-08-27

- Retry interrupted or failed turns directly without appending a synthetic user prompt.

## 0.1.19 - 2026-08-26

- Allow `/continue` to resume provider failures, including rate-limit errors, with the currently selected model.
- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.0

- Add `/continue` for resuming an aborted turn with the currently selected model.
- Support switching models between the interruption and continuation.
