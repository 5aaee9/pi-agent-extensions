# Spec Delta

## Purpose

Version and publish the `@indexyz/*` Pi extension packages of this npm workspace independently, from reviewed release records committed to `main`, without changing the npm package names or the trusted-publisher binding to `.github/workflows/publish.yml`.

## ADDED Requirements

### Requirement: Packages are versioned independently

Each publishable package SHALL carry its own version in its `package.json`, changed only by a release preparation that consumes a positive release intent naming that package. No shared workspace version or synchronized-version check SHALL exist, and no new repository-wide `v<version>` tag SHALL be created or used for publication; existing `v*` tags remain as history. The private workspace root MUST NOT be versioned or published.

#### Scenario: One package changes, five do not

- **WHEN** a release is prepared while only `@indexyz/pi-provider-sub2api` has a pending positive intent
- **THEN** only that package's version and `CHANGELOG.md` change
- **AND** the other five packages keep their current versions and receive no changelog entry

#### Scenario: Versions continue from the current release

- **WHEN** the first independent release is prepared after this change
- **THEN** every package starts from its published `0.1.43` and only prepared packages move past it

### Requirement: Release intents record the decision for a package

A release intent SHALL be a file `.changeset/<id>.md` whose front matter maps exactly one full npm name (`@indexyz/<name>`) to `patch`, `minor`, `major`, or `none`, followed by a user-facing summary; a change affecting several packages records one file per package so that any package can be excluded from a preparation. A `patch`, `minor`, or `major` intent SHALL mean the package should eventually ship with that bump; it SHALL stay pending until a preparation consumes it. A `none` intent SHALL explain why a change needs no release and MUST NOT cause a version change or a publication. An intent naming a package that is not in the workspace, naming more than one package, or lacking a summary SHALL be rejected by validation on pull requests and before publication.

#### Scenario: Intent names two packages

- **WHEN** an intent file maps both `@indexyz/pi-skill` and `@indexyz/pi-continue`
- **THEN** validation fails and asks for one file per package

#### Scenario: Positive intent waits for preparation

- **WHEN** a pull request adds an intent `"@indexyz/pi-skill": minor` and is merged
- **THEN** `pi-skill`'s version is unchanged on `main`
- **AND** the intent is listed as pending until a release preparation consumes it

#### Scenario: None intent never publishes

- **WHEN** the only pending intent for a package is `none`
- **THEN** a release preparation deletes that intent without changing the package's version or changelog
- **AND** nothing is published for that package

### Requirement: Release preparation produces reviewed release records

Consuming intents SHALL, for every selected package with a positive intent, bump `package.json` to the next version implied by the highest pending bump, prepend one `## <version>` section to the package's `CHANGELOG.md` listing the consumed summaries, and delete the consumed intent files. Preparation SHALL support consuming all pending intents or excluding named packages, whose intents stay pending untouched. Existing changelog history SHALL be preserved; the new section is inserted before the first existing version heading.

#### Scenario: Subset preparation leaves other intents pending

- **WHEN** `pi-provider-sub2api` and `pi-skill` both have positive intents and the preparation excludes `pi-skill`
- **THEN** only `pi-provider-sub2api` gains a version bump and changelog section
- **AND** `pi-skill`'s intent file remains for a later preparation

#### Scenario: Highest bump wins

- **WHEN** a package has one `patch` and one `minor` pending intent
- **THEN** its prepared version is a minor bump and its new changelog section lists both summaries

#### Scenario: Historical entries are kept

- **WHEN** `pi-continue/CHANGELOG.md` with its existing `## 0.1.43 - 2026-10-11` entries receives a preparation for `0.1.44`
- **THEN** a `## 0.1.44` section appears above `## 0.1.43 - 2026-10-11` and every existing entry is unchanged

### Requirement: Publication from main publishes only versions absent from the registry

On every push to `main`, and on manual dispatch from `main`, the workflow at `.github/workflows/publish.yml` SHALL determine, without publishing credentials, which publishable packages have a manifest version that is not on the npm registry. Exactly those package versions SHALL be published by a separate job that is the only job with `id-token: write`, each built from that version's commit (the newest commit on `main`'s first-parent history that introduced the version into the package's `package.json`), never from a later state of the package. A push in which every package version is already published and every expected record exists SHALL end successfully without publishing. Registry lookup failures other than "not found" SHALL fail the run rather than count as absence. A manual dispatch from any ref other than `main` SHALL fail before reading any plan.

#### Scenario: Documentation push is a no-op

- **WHEN** a push to `main` changes only documentation, tests, or intent files, every package's current version is published, and every expected record exists
- **THEN** the plan reports nothing to publish or record and the run succeeds without running the publish job

#### Scenario: Package changed after a failed upload

- **WHEN** `pi-skill@0.2.0` was prepared in commit X, its upload failed, and a later commit Y changed `pi-skill/index.ts` under a new pending intent without changing the version
- **THEN** the retry publishes `pi-skill@0.2.0` built from X, not from Y
- **AND** Y's intent stays pending for the next preparation

#### Scenario: Prepared release publishes one package

- **WHEN** a release commit raising `@indexyz/pi-provider-sub2api` to `0.1.44` is pushed to `main`
- **THEN** `@indexyz/pi-provider-sub2api@0.1.44` is published with public access
- **AND** no other package is published

#### Scenario: Registry unreachable

- **WHEN** the registry lookup fails with an authentication, network, or malformed-response error
- **THEN** the run fails before any publish command runs

#### Scenario: Legacy tag push

- **WHEN** a `v*` tag is pushed after this change
- **THEN** no workflow publishes anything

#### Scenario: Dispatch from a branch

- **WHEN** the workflow is dispatched on a ref other than `main`
- **THEN** it fails at its first step and publishes and records nothing

### Requirement: The publish workflow stays compatible with the existing trusted publishers

The publishing workflow file SHALL remain `.github/workflows/publish.yml`, its publish job SHALL run without a GitHub `environment`, and every package SHALL keep its npm name and `repository.url`, so the trusted publishers already configured on npm for the six packages keep authorizing publication without npm-side changes. Before any publish command runs, the repository's full quality checks (format, lint, typecheck, tests) SHALL pass on the pushed commit, and each version to publish SHALL pass its package's own typecheck and tests, artifact inspection, and isolated load on the snapshot it is built from (its version commit).

#### Scenario: First publication after the change

- **WHEN** the first independent release is pushed to `main`
- **THEN** the publish job authenticates through the existing trusted publisher of each published package
- **AND** no npm token is stored in the repository

### Requirement: Publication requires prepared release records

Before publishing, the workflow SHALL verify that every package version it is about to publish has exactly one non-empty `## <version>` section in that package's `CHANGELOG.md` at the version's commit, and that the tarball it will upload, built at that commit, contains the package's manifest, README, changelog, license, and every declared resource, loads in an isolated Pi host, and contains no tests or OpenSpec files. A missing, empty, or duplicate section, or a failing artifact, SHALL fail the run before any package is published.

#### Scenario: Hand-edited version

- **WHEN** a commit raises a package's version without a matching changelog section
- **THEN** the plan job fails and names the package and version
- **AND** no package in that push is published

#### Scenario: Duplicate section

- **WHEN** a package's `CHANGELOG.md` has two `## 0.1.44` sections and `0.1.44` is unpublished
- **THEN** the run fails before publishing

### Requirement: Tags and GitHub Releases record each published version

For every publishable package whose current version is confirmed on the registry, the workflow SHALL ensure a Git tag `@indexyz/<name>@<version>` exists on `origin` pointing at that version's commit (the newest commit on `main`'s first-parent history that introduced that version into the package's `package.json`) and a GitHub Release for that tag whose body is the package's exact `## <version>` changelog section. Missing tags and Releases SHALL be created; existing ones SHALL be left as they are; an existing tag whose commit's `package.json` carries that version SHALL be accepted as the record even if it is not the version commit (a revert to a published version), and that tag's commit SHALL then be the source of the Release's notes and target; a tag pointing at a commit that does not carry the version SHALL be reported as an error and never moved. A version whose changelog has no exact `## <version>` section SHALL get its tag and a notice, and no Release. Two packages released from one commit SHALL get two tags on that commit. Creating these records MUST NOT depend on which run uploaded the version.

#### Scenario: First run after adoption

- **WHEN** the workflow runs on `main` for the first time with every package still at `0.1.43`
- **THEN** it publishes nothing and creates the six `@indexyz/<name>@0.1.43` tags at the commit that set those versions
- **AND** it creates no Release for them because their changelog headings carry a date

#### Scenario: Two packages, one commit

- **WHEN** `@indexyz/pi-skill@0.2.0` and `@indexyz/pi-continue@0.1.44` are published from one release commit
- **THEN** tags `@indexyz/pi-skill@0.2.0` and `@indexyz/pi-continue@0.1.44` both point at that commit
- **AND** each GitHub Release body is that package's own changelog section

#### Scenario: Tag points at a commit without that version

- **WHEN** the tag for a published version points at a commit whose manifest carries a different version
- **THEN** the workflow reports an error for that package and does not move the tag

#### Scenario: Main reverted to a published version

- **WHEN** `main` reverts `pi-skill` from an unpublished `0.2.0` back to the published `0.1.43`, whose tag points at an older commit carrying `0.1.43`
- **THEN** the existing tag is accepted and the run does not fail
- **AND** a Release still missing for a reverted-to version whose tag commit has an exact `## <version>` section is created from the tag's commit, not from the revert commit (for `0.1.43`, whose heading carries a date, no Release is created)

### Requirement: Retries republish only what is missing

Rerunning the original workflow run, or dispatching the workflow on `main`, SHALL recompute the uploads and the records from the committed state: versions already on the registry are skipped, missing versions are published from their own commits, and missing tags or GitHub Releases are created at each version's commit from that commit's changelog, even when there is nothing left to upload. After every published version has its tag, and its Release where an exact section exists, further runs SHALL find no record work. Retries MUST NOT change versions, tag a different commit than the version's own, or edit existing release notes.

#### Scenario: Upload succeeded, tag failed

- **WHEN** a rerun or a dispatch finds `@indexyz/pi-skill@0.2.0` on the registry but no matching tag
- **THEN** it skips the upload and creates the tag and GitHub Release at the commit that set `pi-skill` to `0.2.0`

#### Scenario: Partial batch

- **WHEN** two packages were prepared, the first published and the second failed
- **THEN** a rerun publishes only the second and completes both packages' records

#### Scenario: Release creation failed after upload and tag

- **WHEN** every prepared version is on the registry and tagged but a GitHub Release is missing
- **THEN** a rerun or a dispatch creates the missing Release without uploading anything

#### Scenario: Main advanced before the retry

- **WHEN** `main` received unrelated commits after the release commit and the workflow is dispatched
- **THEN** the missing tag still points at the release commit, not at the current head

### Requirement: Pull requests declare their release impact per package

On every pull request, CI SHALL compare the head with its merge base and, for each package whose published content changed (its `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, or any path listed in `files`), require a decision contributed by that pull request: an intent file added or modified in the pull request that names the package with a non-empty summary, or a release preparation for that package (version changed, a `## <new version>` changelog section added, at least one intent naming the package removed, and no published file of that package changed other than `package.json`, `CHANGELOG.md`, and `README.md`). An intent already pending on the base branch MUST NOT count. Changes limited to tests, `openspec/`, root tooling, or repository documentation SHALL need no decision. A version change without the other preparation signs SHALL fail the gate.

#### Scenario: Source change without a decision

- **WHEN** a pull request edits `pi-skill/index.ts` and adds no intent naming `@indexyz/pi-skill`
- **THEN** the gate fails and prints the package, the changed files, and the command that records a decision

#### Scenario: Stale intent does not cover new work

- **WHEN** `main` already has a pending intent for `@indexyz/pi-skill` and a pull request changes `pi-skill/index.ts` without adding or modifying an intent for it
- **THEN** the gate fails for `pi-skill`

#### Scenario: Reasoned none passes

- **WHEN** a pull request changes `pi-skill/README.md` and adds a `none` intent for `@indexyz/pi-skill` with a reason
- **THEN** the gate passes and the package is not scheduled for publication

#### Scenario: Release preparation passes

- **WHEN** a pull request bumps `pi-skill` to `0.2.0`, adds a `## 0.2.0` section, and deletes the consumed intent
- **THEN** the gate accepts the preparation as `pi-skill`'s decision without a new intent

#### Scenario: Source change hidden in a preparation

- **WHEN** a pull request prepares `pi-skill@0.2.0` and also edits `pi-skill/index.ts` without adding an intent
- **THEN** the gate fails for `pi-skill` and asks for an intent covering the source change

#### Scenario: Tests only

- **WHEN** a pull request changes only `pi-skill/test/skill.test.ts` and `pi-skill/openspec/`
- **THEN** the gate passes without a decision
