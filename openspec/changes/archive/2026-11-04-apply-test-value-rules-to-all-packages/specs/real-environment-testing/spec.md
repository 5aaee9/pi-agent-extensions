# Spec Delta

## ADDED Requirements

### Requirement: Package tests assert behaviour that can break

A package test SHALL assert behaviour a caller relies on and that could plausibly break. It SHALL NOT merely restate the implementation, assert a manifest, configuration, documentation, or test helper, assert the host's behaviour rather than the package's, repeat a failure mode another test already covers, or pass regardless of the behaviour it names.

#### Scenario: A test pins a constant from the code

- **WHEN** a test's expected value is a copy of a constant, a default, or a display string whose change has no user-visible failure mode
- **THEN** the test does not meet this requirement and is removed

#### Scenario: A test checks the manifest

- **WHEN** a test reads a package's `package.json` to assert its dependency layout
- **THEN** the test does not meet this requirement; loading the installed tarball is the proof

#### Scenario: A test passes with its subject broken

- **WHEN** a test keeps passing after the behaviour it names is removed
- **THEN** the test is corrected to detect that behaviour or removed

#### Scenario: A dsh package test repeats a covered failure

- **WHEN** a test in a `dsh-<topic>/` package fails only when another test in that package already fails
- **THEN** the test does not meet this requirement and is removed

### Requirement: A regression guard is removed only with its replacement

A package test that guards a real past bug SHALL be removed only after a scenario or test covering the same failure mode exists and has been observed detecting it. A package test that guards a user-visible behaviour SHALL be removed only when another test in the package asserts the same path, or a scenario with a recorded observation covers that failure.

#### Scenario: A stand-in test guards a production fix

- **WHEN** a test on a stand-in host is the only guard of a past production fix
- **THEN** the replacing E2E scenario lands and is observed failing against a regression of that fix before the original test is deleted

#### Scenario: A source check guards a past dsh bug

- **WHEN** a test that inspects a dsh package's source guards a past bug and a test of the built entry covers the same failure
- **THEN** the source check is removed only after the built-entry test has been observed failing against that bug

#### Scenario: A test repeats a user-visible behaviour another test asserts

- **WHEN** a test guards a user-visible behaviour and another test in the package asserts the same path
- **THEN** the test may be removed without a separate mutation run, and the audit names the rule it was removed under

## REMOVED Requirements

### Requirement: Pi package tests assert behaviour that can break

**Reason**: The rule now covers every package.

**Migration**: Use "Package tests assert behaviour that can break".

### Requirement: A Pi regression guard is removed only with its replacement

**Reason**: The rule now covers every package, and a user-visible-behaviour guard no longer always needs an observed mutation; `proposal.md` gives the reason and the trade-off.

**Migration**: Use "A regression guard is removed only with its replacement".
