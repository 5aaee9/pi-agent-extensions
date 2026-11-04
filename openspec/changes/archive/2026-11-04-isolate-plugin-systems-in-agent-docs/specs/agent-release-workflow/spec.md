# Spec Delta

## MODIFIED Requirements

### Requirement: One canonical release runbook

`docs/releases.md` SHALL be the entry point of the single release procedure, with CI mechanics and recovery in `docs/releases/ci.md` and the first release of a new package in `docs/releases/first-release.md`. `AGENTS.md` SHALL link these documents and the `pi-extension-dev` skill SHALL route to them rather than restate them, and `docs/workflow.md`, the root `README.md`, and package READMEs SHALL agree with them. The runbook SHALL separate what the agent does locally from what CI does after a push to `main`.

#### Scenario: Agent starts a package change

- **WHEN** an agent reads `AGENTS.md` and loads the `pi-extension-dev` skill
- **THEN** both lead to the same runbook for recording intents, preparing versions, and reporting outcomes

### Requirement: The runbook covers both package classes

The release documents SHALL stay the single release procedure for both classes and SHALL NOT state a package count that the workspace no longer has. The identity table in `docs/releases.md` SHALL name the dsh directory (`dsh-<topic>/`, loaded by a dsh profile and not by `pi -e`), the npm name `@indexyz/dsh-<topic>`, and the tag form `@indexyz/<name>@<version>`, and `docs/conventions.md` SHALL state the Conventional Commit scope (the directory name without its class prefix, so `autocompact` for `dsh-autocompact`, spelled out when a `pi-<topic>/` package would share it; `release` for preparations and `repo` for repository-wide changes). The "What CI does" section of `docs/releases/ci.md` SHALL state that verification uses either the in-Pi load or the check a package declares with `release.smoke`, and `docs/dsh/README.md` SHALL have a section for the package a Pi load cannot verify that documents the declared check: a relative `.ts` path, run from the version commit's worktree with the installed package directory as its only argument, which must exit 0 and whose own output is the failure detail, and which replaces the Pi load and nothing else. The activation table in `docs/releases/ci.md` SHALL have a trusted-publisher row that covers every published package, including a new one, configured after its `0.0.0` bootstrap upload and before its first formal push. `docs/releases/first-release.md` SHALL be the procedure for every new npm package of either class: the agent prepares an independent empty `0.0.0` workspace outside the repository, the owner publishes it with the `bootstrap` tag and configures the trusted publisher, and the verified formal version is then pushed so CI publishes and records it; agents never perform the owner's steps. Everything else — intents, the gate table, local preparation, the no-op and failure tables, report, retry, and the abandonment rule — SHALL keep its current meaning for both classes.

#### Scenario: A dsh release decision

- **WHEN** an agent records a decision for a change to `dsh-autocompact/`
- **THEN** the documents tell it the intent names `@indexyz/dsh-autocompact`, the commit scope is `autocompact`, and the directory stays `dsh-autocompact/`

#### Scenario: Verification of a dsh package is documented

- **WHEN** the "What CI does" section is read for a package that declares `release.smoke`
- **THEN** it says the installed tarball is verified by that declared script instead of the Pi load, and that every other step is unchanged

#### Scenario: The first release needs the owner

- **WHEN** a package has never been published
- **THEN** `docs/releases/first-release.md` is the procedure: the owner publishes the empty bootstrap package and adds the trusted publisher, after which CI publishes the formal version and records its tag and Release

#### Scenario: The Pi packages' procedure is unchanged

- **WHEN** an agent prepares a release for a `pi-*` package
- **THEN** every step, gate row, and failure row it uses keeps its meaning, in the document that now holds it
