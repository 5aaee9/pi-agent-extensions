# Changelog

## 0.2.0

### Minor Changes

- Save a model's compaction threshold with `/autocompact 300k --save` so later sessions reuse it. The value is stored in user settings under `piAutocompact.modelLimits`. Without `--save`, the threshold stays session-only.

## 0.1.43 - 2026-10-11

- Synchronize the package version with the provider packages for coordinated workspace releases.

## 0.1.42 - 2026-10-08

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.41 - 2026-10-08

- Add session-only per-model `/autocompact` thresholds and optional read-only global defaults.
- Compact at actionable session boundaries without aborting tool continuation or modifying model metadata.
