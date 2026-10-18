# Spec Delta

## Purpose

Package the plugin as an installable dsh bundle with a verifiable Host artifact, browser artifact, and release smoke contract.

## ADDED Requirements

### Requirement: dsh bundle manifest and build

The package SHALL declare a dsh bundle patch, build its Host half to `lib/`, bundle its browser half to one `client.js`, and include both generated artifacts in the published tarball through `prepack` and `files`. Host-provided packages SHALL be peers and pinned dev dependencies.

#### Scenario: Fresh install

- **WHEN** the package is installed into a dsh web profile
- **THEN** the loader sees one inserted `prompt-suggestions` row and the browser bundle registers its slots

#### Scenario: Published files

- **WHEN** the package is packed
- **THEN** the tarball contains the Host entry, browser bundle, patch, README, changelog, license, and declared source files

### Requirement: Authenticated Connection route

The Host SHALL register a POST Fetch route for suggestion queries on the authenticated Connection API and answer with the standard Client/Server RPC envelope. Invalid methods, oversized/malformed bodies, and missing session identities MUST be rejected without calling the model. The route MUST be registered only while the plugin and Connection service are active.

#### Scenario: Valid query

- **WHEN** the browser posts a valid Client envelope with a live session id
- **THEN** the Host answers with a Server envelope containing the typed suggestion state

#### Scenario: Invalid request

- **WHEN** the request is not POST, is oversized, is malformed JSON, has the wrong method, or omits the session id
- **THEN** the Host rejects it without invoking generation

#### Scenario: Plugin disposal

- **WHEN** the plugin unloads
- **THEN** the route is unregistered and in-flight work is aborted

### Requirement: Release smoke verification

The package SHALL provide a `release.smoke` script that verifies the packed/installed manifest targets and evaluates `client.js` through the Harness module-loader contract. It MUST check the module id, injected services, both slot registrations, localized copy, and disposal without host peers or real Remote calls.

#### Scenario: Installed tarball smoke

- **WHEN** the smoke script runs against an installed package directory
- **THEN** it verifies manifest paths, the bundle patch row, the client module id, injected services, overlay/settings registrations, locale copy, and slot cleanup

#### Scenario: Host peers absent

- **WHEN** the smoke runs without live Harness services or model credentials
- **THEN** it completes using only Node built-ins and the module-loader contract

### Requirement: Documentation and release decision

The package SHALL document installation, behavior, keys, priorities, cost, privacy, limits, and verification, SHALL be added to the root workspace and README table, and SHALL carry a release intent for its published content.

#### Scenario: Documentation available

- **WHEN** a user reads the package README
- **THEN** it explains how to install, enable, accept, dismiss, and verify the plugin and what it does and does not send

#### Scenario: Release intent

- **WHEN** the change is reviewed
- **THEN** a changeset records the package's first-release decision
