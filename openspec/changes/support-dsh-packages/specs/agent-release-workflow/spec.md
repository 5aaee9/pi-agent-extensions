# Spec Delta

## Purpose

Keep the single release runbook in `docs/releases.md` correct for a workspace of seven packages in two classes, so that an agent records, prepares, verifies, and reports a dsh package's release exactly as it does a Pi package's, with the one bootstrap difference a never-published package needs.

## ADDED Requirements

### Requirement: The runbook covers seven packages in two classes

`docs/releases.md` SHALL stay the single release procedure for both classes and SHALL NOT state a package count that the workspace no longer has: every count it gives SHALL be true for seven packages today, and the historical rows that describe the first run after adoption (the six `0.1.43` tags at `b997bd2`) keep their meaning as the record of that run. Its identity table SHALL name the dsh directory (`dsh-<topic>/`, loaded by a dsh profile and not by `pi -e`), the npm name `@indexyz/dsh-<topic>`, the Conventional Commit scope (the directory name without its class prefix, so `autocompact` for both `pi-autocompact` and `dsh-autocompact`; `release` for preparations and `repo` for repository-wide changes), and the tag form `@indexyz/<name>@<version>`. Its "What CI does" section SHALL state that verification uses either the in-Pi load or the check a package declares with `release.smoke`, and SHALL have a section for the package a Pi load cannot verify that documents the declared check: a relative `.ts` path, run from the version commit's worktree with the installed package directory as its only argument, which must exit 0 and whose own output is the failure detail, and which replaces the Pi load and nothing else. Its activation table's trusted-publisher row SHALL cover every published package, including a new one after its first manual publish. Its "First release of a new package" section SHALL be the procedure for `@indexyz/dsh-autocompact@0.1.0` unchanged: the plan verifies the version and its publish job fails at the upload, the owner publishes that exact tarball once, adds the trusted publisher, and reruns so the tag and Release are recorded; agents never perform that step. Everything else — intents, the gate table, local preparation, the no-op and failure tables, report, retry, and the abandonment rule — SHALL keep its current meaning for both classes.

#### Scenario: A dsh release decision

- **WHEN** an agent records a decision for a change to `dsh-autocompact/`
- **THEN** the runbook tells it the intent names `@indexyz/dsh-autocompact`, the commit scope is `autocompact`, and the directory stays `dsh-autocompact/`

#### Scenario: Verification of a dsh package is documented

- **WHEN** the runbook's "What CI does" section is read for a package that declares `release.smoke`
- **THEN** it says the installed tarball is verified by that declared script instead of the Pi load, and that every other step is unchanged

#### Scenario: The first release needs the owner

- **WHEN** `@indexyz/dsh-autocompact@0.1.0` is the planned upload and the package has never been published
- **THEN** the runbook's bootstrap section is the procedure: the owner publishes the verified tarball once and adds the trusted publisher, after which CI records the tag and Release

#### Scenario: The Pi packages' procedure is unchanged

- **WHEN** an agent prepares a release for a `pi-*` package
- **THEN** every step, gate row, and failure row it uses is the one it used before this change
