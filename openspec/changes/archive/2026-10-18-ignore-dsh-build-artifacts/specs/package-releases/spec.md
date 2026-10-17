# Spec Delta

## ADDED Requirements

### Requirement: Dsh build inputs require release decisions

For packages declaring a `dsh` manifest, the release gate SHALL require an added or modified release intent for changes to runtime TypeScript at the package root, any `src/` input, `tsconfig*.json`, and `tsdown.config.ts`, in addition to published paths. Root test files and `vitest.config.ts` SHALL be excluded from the added input rule. Pi package classification SHALL remain unchanged.

#### Scenario: Source outside the published allowlist changes

- **WHEN** a dsh package publishes only built `lib/` output and a pull request modifies its root `index.ts` or another root runtime TypeScript module
- **THEN** the gate fails without a new or modified release intent and passes with a valid intent, including a reasoned `none`

#### Scenario: Build configuration changes

- **WHEN** a pull request modifies a dsh package's TypeScript build configuration or browser bundler configuration
- **THEN** the gate requires a release decision even if no generated artifact is tracked

#### Scenario: Development-only files change

- **WHEN** only a dsh package's `test/`, root test files, `vitest.config.ts`, or `openspec/` files change and none are in the published allowlist
- **THEN** the gate does not require a release decision

#### Scenario: A preparation also changes a build input

- **WHEN** a dsh release preparation also modifies an unpublished runtime source or build configuration
- **THEN** the gate requires a new or modified intent for that input change in addition to the consumed preparation intent
