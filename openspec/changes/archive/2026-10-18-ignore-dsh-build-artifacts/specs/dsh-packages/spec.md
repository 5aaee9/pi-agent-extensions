# Spec Delta

## Purpose

Define how dsh packages keep generated files out of source control while providing built artifacts for local Harness installs and published npm packages.

## ADDED Requirements

### Requirement: Generated dsh artifacts are ignored by Git

The repository SHALL ignore root-level `dsh-*/lib/` and `dsh-*/client.js` and SHALL NOT track generated files at those paths. Removing existing index entries SHALL preserve local output files.

#### Scenario: Build after checkout

- **WHEN** a contributor builds any dsh workspace package
- **THEN** its generated host and optional browser output exists on disk and does not appear as an untracked or modified file in Git

### Requirement: Packaging builds the artifacts the Harness loads

Each dsh package SHALL build its host and optional browser output during `prepack`, and its npm `files` allowlist SHALL include those artifacts despite Git ignoring them. Local checkout installation instructions SHALL run the package build before adding its directory to a dsh profile.

#### Scenario: Pack a checkout without generated output

- **WHEN** dependencies are installed and a dsh package is packed from a checkout containing no generated output
- **THEN** packing builds the output and the installed tarball passes the package's declared release smoke check

#### Scenario: Link a local checkout

- **WHEN** a contributor follows the documented checkout installation procedure
- **THEN** the host entry and optional browser bundle exist before the Harness loads the linked directory
