# agent-guidance Specification

## Purpose

Define what the shared agent instruction surface (`AGENTS.md`, `docs/`) must tell an agent, so that following the documents alone produces package work that meets the repository's contracts — today, the real-environment testing contract and the boundaries it records.

## Requirements

### Requirement: The instruction surface requires real-environment testing

`docs/conventions.md` (Tests section) SHALL state that every package test exercises the host plane the package pins — the real host packages, services, loaders, DOM, and HTTP clients — and SHALL NOT replace a host package, service, loader, DOM, or HTTP client with a stand-in for the duration of the test.

#### Scenario: An agent writes a new package test

- **WHEN** an agent follows `docs/conventions.md` to add a test to any package
- **THEN** the rules route it to drive the pinned host plane, and no instruction invites a fake or a module replacement of a host package

#### Scenario: The old thin-index contract is gone

- **WHEN** `docs/conventions.md` is searched for the claim that logic must be testable without a running host
- **THEN** that claim no longer stands as the testing contract

### Requirement: Verification docs record the testing boundaries

`docs/workflow.md` (Verify) SHALL state that a package's verification runs through its host, and SHALL record two boundaries explicitly: which package's live-endpoint tests are deferred by owner decision, and that credential-gated model paths are recorded as blocked when their credential route is undecided. `AGENTS.md` rule 5 SHALL keep pointing at that documentation rather than restating the mock policy.

#### Scenario: A deferred package is discoverable

- **WHEN** an agent reads `docs/workflow.md` before touching `pi-provider-sub2api`
- **THEN** it finds that that package's live-endpoint tests are currently deferred by owner decision, and it must not convert them silently or fake them

#### Scenario: The rule pointer stays stable

- **WHEN** `AGENTS.md` rule 5 is read
- **THEN** it still points at `docs/workflow.md` and `docs/conventions.md` for the testing requirement, and does not itself carry a list of banned test constructs
