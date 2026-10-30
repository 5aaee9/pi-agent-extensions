# Spec Delta

## Purpose

Define what it means for a package test to be real: the test must drive the package through the host plane the package pins (real services, real loaders, real DOM, real HTTP client, real model settings), so a passing test is evidence the real host accepted the package rather than evidence about a hand-built stand-in of it.

## ADDED Requirements

### Requirement: Every package test exercises its pinned host plane

Every test in a package's `test/` tree SHALL drive that package through the host packages it pins in its `devDependencies` at runtime — mounted, registered, or loaded through the host's own public mechanisms — and SHALL NOT replace a host package, a host service, or a host API with a hand-written stand-in for the duration of the test.

#### Scenario: A host API contract changes on the pinned line

- **WHEN** a mounted host service gains or loses a dependency in its own `inject` list, or renames or removes an export the package consumes
- **THEN** the package test observes the change through the real service graph and fails or passes as the real host decides, without the test being edited to describe the new contract

#### Scenario: A test constructs a stand-in host

- **WHEN** a test in any package builds its host out of a fake settings object, a fake engine, a fake LLM stream, or a module/global replacement of a host package
- **THEN** that test does not meet this requirement and must be rewritten to drive the real plane

### Requirement: DSH plugin tests run in the real service plane

A dsh package test SHALL construct its host by instantiating the pinned dsh runtime and mounting the real services the package needs (the package's own plugin plus the real host services and registries it injects), and SHALL observe the package's behaviour through the resulting real context objects and event projections.

#### Scenario: A dsh plugin mounts a service graph

- **WHEN** the package's plugin and the real host services it depends on are mounted in order against a real context
- **THEN** the assertions hold against the values and events the real services produce, including projection and registration side effects

#### Scenario: A dsh host service is missing from the plane

- **WHEN** a service the package requires is not mounted in the plane
- **THEN** the package's activation behaves exactly as the real host behaves in that case, and the test states that boundary rather than supplying a substitute

### Requirement: Client-half tests run in a real browser plane

Tests of a dsh package's built client half SHALL load its real generated `client.js` into a real DOM environment and SHALL assert against the real components from the pinned host packages, with the client's module-registration contract executed rather than simulated.

#### Scenario: The client artifact registers through the module loader

- **WHEN** the built client half is evaluated with a real window and DOM
- **THEN** its single module-loader registration and its rendered components are those of the real host packages, and the assertions hold on the resulting real nodes and components

#### Scenario: A primitives component is replaced for a test

- **WHEN** a test replaces a host-provided UI package with a stub component or a fake DOM
- **THEN** that test does not meet this requirement

#### Scenario: A pinned host package cannot be evaluated outside its own build pipeline

- **WHEN** the pinned host package ships artifacts its own build pipeline resolves (style-sheet files, imports it neither declares nor ships), so no dependency pin set can make it loadable standalone
- **THEN** the assertion is recorded as blocked until it is driven through the host's real built plane, and neither the pin set nor an empty or stand-in module-table entry counts as satisfying it

### Requirement: Network-shaped code is exercised through a real client

Where a package performs a network call, its test SHALL exercise that path through the real HTTP client against a real server — a locally started one where credentials are not needed — and SHALL NOT stub the client entry point or its responses.

#### Scenario: A local server stands in for the endpoint's shape

- **WHEN** the code path under test is pointed at a locally started server that answers the request's real protocol
- **THEN** the real client's routing, headers, aborts, and error-status handling are what the assertions observe

#### Scenario: No credential exists for the real endpoint

- **WHEN** a path needs a credential the environment does not hold
- **THEN** the test fails loudly naming the credential route it needs, and no fake response and no silent skip stands in for it

### Requirement: Model behaviour is exercised through the real model stack

Where a package streams or resolves models through the host's LLM stack, its tests SHALL drive that real stack with a model selected through the host's own settings surface, and SHALL NOT inject a fake stream or a fake model resolution into the host.

#### Scenario: A settings-selected model drives a stream

- **WHEN** the host plane is given a model through the settings surface the package itself reads
- **THEN** the package's stream handling, reasoning-effort handling, and error handling are asserted against the real stack's behaviour

#### Scenario: The credential route is undecided

- **WHEN** no credential route for the real endpoint has been confirmed for the environment
- **THEN** that model-path conversion is recorded as blocked and left pending rather than satisfied by a stand-in

### Requirement: Loading proof stays owned by the release smoke and the e2e run

Package unit tests SHALL NOT re-implement packing, isolated installation, or host-binary loading as their proof mechanism; the packed-and-installed proof remains the package's declared `release.smoke` script and the repository `test:e2e` run.

#### Scenario: A unit test hand-packs its own tarball

- **WHEN** a unit test builds, packs, or installs its own package to stand in for the loading proof
- **THEN** the change is not the way this capability is satisfied; that proof remains in the declared smoke check and the e2e run

#### Scenario: The declared smoke script changes its harness

- **WHEN** a package's `release.smoke` script is rewritten to run against a real environment instead of an in-process harness
- **THEN** the manifest still declares the same relative script, the published files do not change, and `npm run check` plus the e2e run must stay green

### Requirement: Conversion never touches published content

A conversion SHALL live inside the package's `test/` tree (test modules, helpers, and the package's own declared smoke script path) and SHALL NOT change any file listed in the package's `files` allowlist, its manifest, its versions, or its changelogs; therefore no conversion by itself needs a release intent.

#### Scenario: A conversion would need a new host package

- **WHEN** exercising the real plane requires a host package the package manifest does not already pin
- **THEN** that manifest change is a separate change with its own release decision, not part of a test conversion
