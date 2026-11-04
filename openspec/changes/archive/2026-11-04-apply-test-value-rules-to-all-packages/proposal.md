# Proposal

## Why

The rule that a test must assert behaviour that can break, and its regression-guard safeguard, were written for Pi packages only, so dsh packages kept tests that restate constants, assert host behaviour, or repeat a failure mode already covered. The owner requires every plugin in this repository to drop tests that add no value.

## What Changes

- Apply the test-value rule and the regression-guard rule to every package, and add repeating an already covered failure mode to what a test must not do.
- Revise the safeguard. Before this change, a test guarding a past bug or a user-visible behaviour could go only after a replacement was observed detecting the failure. Now a past-bug guard keeps that requirement, and a user-visible-behaviour guard may go when another test in the package asserts the same path or a scenario with a recorded observation covers that failure. A separate mutation run per duplicate adds no evidence about a failure another test already asserts, while the owner has asked for an end to unnecessary test work. The trade-off is that "asserts the same path" is judged by reading, so a contested removal gets a targeted mutation.
- State both rules in `docs/conventions.md`. Pi's exception for testing its own logic without a running host stays Pi-only, and dsh package tests stay bound to the real service plane.
- Remove 81 of the 318 test cases in the four dsh packages and 80 of the 439 test runs in the eight Pi packages under that rule. `audit.md` has the summary.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `real-environment-testing`: the two Pi-only test-value requirements now cover every package, and the safeguard for user-visible-behaviour guards no longer always requires an observed mutation.

## Impact

- Affected packages: `dsh-autocompact`, `dsh-custom-provider-reasoning-efforts`, `dsh-prompt-suggestions`, and `dsh-thread-summary`. The change is repository-wide because it changes a rule for all of them and the shared conventions.
- Release decisions: none needed, because only unpublished `*.test.ts` files change in these packages.
- The eight Pi packages, audited earlier by `2026-11-04-replace-low-value-pi-tests-with-e2e`, are screened again for repeated failure modes, and 80 test runs are removed. Only unpublished `*.test.ts` files change, so they need no release decision either.
