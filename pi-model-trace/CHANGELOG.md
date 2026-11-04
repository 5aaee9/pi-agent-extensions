# Changelog

## 0.1.45

### Patch Changes

- Update the bundled unified fingerprint bank to the 2026-09-15 build: 30 candidate models, adding Doubao (Seed) candidates and refitting the enrolled providers' reference counts.
- Enroll claude-opus-5.5 and glm-5.3-flash (32 candidates).
- Enroll grok-4.7 (33 candidates).
- Enroll deepseek-v4.1-flash-1017, adding the DeepSeek family (34 candidates).
- Models added on their own keep the probability calibration fitted on the original reference rows; `robust.incremental_enrollments` records each addition.

## 0.1.44

### Patch Changes

- Run ModelTrace probes with the current Pi host, preserve thinking off, and cancel bounded probe processes when the session closes. Discard failed or truncated probe output instead of attributing incomplete responses.

## 0.1.43 - 2026-10-11

- Synchronize the package version with the provider packages for coordinated workspace releases.

## 0.1.42 - 2026-10-08

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.41 - 2026-10-08

- Synchronize the package version with `@indexyz/pi-autocompact` for coordinated workspace releases.

## 0.1.40 - 2026-10-04

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.39 - 2026-10-04

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.38 - 2026-10-04

- Synchronize the package version for coordinated workspace releases.

## 0.1.37 - 2026-10-03

- Synchronize the package version for coordinated workspace releases.

## 0.1.36 - 2026-10-02

- Synchronize the package version with `@indexyz/pi-provider-sub2api` for coordinated workspace releases.

## 0.1.35 - 2026-09-15

- Update the bundled unified fingerprint bank to 24 candidate models.

## 0.1.34 - 2026-09-15

- First public release. Add `/model-trace` for attributing the model actually serving pi via ModelTrace numeric fingerprinting.
- Run three independent no-session probes and score outputs against the bundled unified fingerprint bank.
