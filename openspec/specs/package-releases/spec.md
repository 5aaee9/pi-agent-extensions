# package-releases Specification

## Purpose

Make the publish step wait out npm registry propagation instead of failing a version it just uploaded, on one bounded budget for the whole run, so a release records itself without a human rerun while a genuine registry problem still fails.

## Requirements

### Requirement: A version the registry does not serve yet is waited for, not failed

When the publish step uploads a version and the registry does not confirm it on the first lookup, the step SHALL re-check that version on an exponential backoff instead of failing, until the registry confirms it or the run's wait budget is exhausted. The same wait SHALL apply when `npm publish` answers that the version is already published while the registry re-check does not confirm it, because that is the same race seen on the upload path. Once the wait sees the version, the step SHALL record it — creating its tag and its GitHub Release exactly as for a confirmed upload.

#### Scenario: A version becomes visible after a short delay

- **WHEN** `npm publish` succeeds for `@indexyz/pi-skill@0.1.44` and `npm view` does not confirm the version on the first lookup
- **THEN** the step waits out the backoff without failing, confirms the version as soon as the registry serves it, and creates its tag and GitHub Release as an ordinary published version

#### Scenario: npm reports the version already published but the registry does not show it

- **WHEN** `npm publish` answers "cannot publish over the previously published versions" and the immediate `npm view` re-check does not confirm the version
- **THEN** the upload counts as already published once the wait confirms it, later uploads continue, and its tag and GitHub Release are created

### Requirement: The wait has one 30-minute budget shared by the publish run

The wait SHALL have a single deadline shared by the whole publish run, established when the run first needs to wait and never extended, so the total time the run spends waiting SHALL NOT exceed 30 minutes however many versions it waits for. Each wait SHALL be clamped to the remaining budget, so no wait extends past the deadline, and a version confirmed during the last wait SHALL still be recorded. A version the registry still does not confirm when the budget is exhausted SHALL fail the run with an error naming that version and the exhausted wait, and SHALL get no tag and no GitHub Release, leaving a rerun as the backstop.

#### Scenario: A version never becomes visible

- **WHEN** an uploaded version is still unconfirmed when the run's 30 minutes of waiting are exhausted
- **THEN** the run fails with an error naming the version and the exhausted wait, and creates no tag and no GitHub Release for it

#### Scenario: The budget is shared by the run

- **WHEN** a first version consumes the whole wait budget and a later version of the same run is still unconfirmed
- **THEN** the later version does not receive a fresh 30 minutes: it fails after a single lookup and no further waiting, and the run's total waiting stays within the budget

### Requirement: Only a live registry answer is waited on

Because the wait decides what the registry serves right now, every lookup it makes SHALL revalidate with the registry rather than answer from a cached package document that predates the upload. A version that is genuinely absent SHALL NOT be waited for: an upload that failed for a reason other than "already published", or that was not attempted because an earlier upload failed, SHALL get its single lookup and its "not on the registry; not recorded" notice. A lookup that fails with an authentication, network, or malformed-response error SHALL fail the run immediately, because a failed lookup is not absence.

#### Scenario: A version that is genuinely absent is not waited for

- **WHEN** an upload failed for a reason other than "already published", or was not attempted because an earlier upload failed, and the registry does not show that version
- **THEN** the step performs a single lookup, records nothing for it, and does not wait

#### Scenario: A failing lookup is not propagation

- **WHEN** a registry lookup fails with an authentication, network, or malformed-response error instead of answering that the version is absent
- **THEN** the run fails immediately with that error and no waiting

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

### Requirement: Packages are versioned independently

Each publishable package SHALL carry its own version in its `package.json`, changed only by a release preparation that consumes a positive release intent naming that package. No shared workspace version or synchronized-version check SHALL exist, and no new repository-wide `v<version>` tag SHALL be created or used for publication; existing `v*` tags remain as history. The private workspace root MUST NOT be versioned or published.

#### Scenario: One package changes, the others do not

- **WHEN** a release is prepared while only `@indexyz/pi-provider-sub2api` has a pending positive intent
- **THEN** only that package's version and `CHANGELOG.md` change
- **AND** every other package keeps its current version and receives no changelog entry

#### Scenario: Versions continue from the current release

- **WHEN** a release is prepared
- **THEN** each prepared package's next version continues from the version in its manifest, and only prepared packages move

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

The publishing workflow file SHALL remain `.github/workflows/publish.yml`, its publish job SHALL run without a GitHub `environment`, and every package SHALL keep its npm name and `repository.url`, so the trusted publisher configured on npm for each published package keeps authorizing publication without npm-side changes; a new package gets its trusted publisher through the first-release procedure in `docs/releases.md`. Before any publish command runs, the repository's full quality checks (format, lint, typecheck, tests) SHALL pass on the pushed commit, and each version to publish SHALL pass its package's own typecheck and tests, artifact inspection, and smoke check (an isolated Pi load, or the script the package declares with `release.smoke`) on the snapshot it is built from (its version commit).

#### Scenario: Publication of a prepared version

- **WHEN** a prepared version is pushed to `main`
- **THEN** the publish job authenticates through that package's trusted publisher
- **AND** no npm token is stored in the repository

### Requirement: Publication requires prepared release records

Before publishing, the workflow SHALL verify that every package version it is about to publish has exactly one non-empty section for that version in that package's `CHANGELOG.md` at the version's commit, and that the tarball it will upload, built at that commit, contains the package's manifest, README, changelog, license, and every declared resource, passes the package's smoke check, and contains no tests or OpenSpec files. A missing, empty, or duplicate section, or a failing artifact, SHALL fail the run before any package is published.

#### Scenario: Hand-edited version

- **WHEN** a commit raises a package's version without a matching changelog section
- **THEN** the plan job fails and names the package and version
- **AND** no package in that push is published

#### Scenario: Duplicate section

- **WHEN** a package's `CHANGELOG.md` has two `## 0.1.44` sections and `0.1.44` is unpublished
- **THEN** the run fails before publishing

### Requirement: Tags and GitHub Releases record each published version

For every publishable package whose current version is confirmed on the registry, the workflow SHALL ensure a Git tag `@indexyz/<name>@<version>` exists on `origin` pointing at that version's commit (the newest commit on `main`'s first-parent history that introduced that version into the package's `package.json`) and a GitHub Release for that tag whose body is that version's changelog section. Missing tags and Releases SHALL be created; existing ones SHALL be left as they are; an existing tag whose commit's `package.json` carries that version SHALL be accepted as the record even if it is not the version commit (a revert to a published version), and that tag's commit SHALL then be the source of the Release's notes; a tag pointing at a commit that does not carry the version SHALL be reported as an error and never moved. A version whose changelog has no section for it SHALL get its tag and a notice, and no Release. A tag GitHub refuses to an Actions token, because its commit predates a workflow change on `main`, SHALL be pushed once by the owner. Two packages released from one commit SHALL get two tags on that commit. Creating these records MUST NOT depend on which run uploaded the version.

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
- **AND** a Release still missing for a reverted-to version whose tag commit has a section for that version is created from the tag's commit, not from the revert commit

### Requirement: Retries republish only what is missing

Rerunning the original workflow run, or dispatching the workflow on `main`, SHALL recompute the uploads and the records from the committed state: versions already on the registry are skipped, missing versions are published from their own commits, and missing tags or GitHub Releases are created at each version's commit from that commit's changelog, even when there is nothing left to upload. After every published version has its tag, and its Release where a section exists, further runs SHALL find no record work. Retries MUST NOT change versions, tag a different commit than the version's own, or edit existing release notes.

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

On every pull request, CI SHALL compare the head with its merge base and, for each package whose published content changed (its `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, or any path listed in `files`), require a decision contributed by that pull request: an intent file added or modified in the pull request that names the package with a non-empty summary, or a release preparation for that package (version changed, a `## <new version>` changelog section added, at least one positive (`patch`, `minor`, or `major`) intent naming the package removed, and no published file of that package changed other than `package.json`, `CHANGELOG.md`, and `README.md`). An intent already pending on the base branch MUST NOT count. Changes limited to tests, `openspec/`, root tooling, or repository documentation SHALL need no decision. A version change without the other preparation signs SHALL fail the gate.

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

#### Scenario: Hand bump that deletes only a none intent

- **WHEN** a pull request raises `pi-skill` to `0.2.0`, adds a `## 0.2.0` section, and deletes only a `none` intent naming `@indexyz/pi-skill`
- **THEN** the gate fails for `pi-skill`, because no positive intent was consumed

#### Scenario: Source change hidden in a preparation

- **WHEN** a pull request prepares `pi-skill@0.2.0` and also edits `pi-skill/index.ts` without adding an intent
- **THEN** the gate fails for `pi-skill` and asks for an intent covering the source change

#### Scenario: Tests only

- **WHEN** a pull request changes only `pi-skill/test/skill.test.ts` and `pi-skill/openspec/`
- **THEN** the gate passes without a decision

### Requirement: A package declares how its installed tarball is verified

A package manifest MAY declare `release.smoke`, the path of a TypeScript script relative to the package directory. The value SHALL be a non-empty relative path whose file name ends in `.ts`; any other value SHALL fail manifest parsing before the plan continues, with a message naming `release.smoke`. A declared script SHALL select the package's check in preference to any Pi resources the manifest also declares, so one package can choose its own verification. A package that declares neither Pi resources nor `release.smoke` SHALL fail the plan with an error naming the package, because nothing can verify its installed tarball.

#### Scenario: A dsh package declares its own check

- **WHEN** a package manifest carries `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` and `"release": { "smoke": "test/smoke-release.ts" }`
- **THEN** the plan resolves that package's check to the declared script, not to the Pi load

#### Scenario: A Pi package declares nothing

- **WHEN** a `pi-*` manifest declares `pi.extensions: ["./index.ts"]` and no `release` block
- **THEN** its check is the existing Pi load and its verification is unchanged

#### Scenario: A malformed declaration

- **WHEN** `release.smoke` is `/test/smoke.ts`, `test/smoke.js`, or an empty string
- **THEN** parsing the manifest fails and names `release.smoke`

#### Scenario: A declaration wins over Pi resources

- **WHEN** a manifest declares both `pi.extensions` and `release.smoke`
- **THEN** the declared script is the package's check

#### Scenario: Nothing can verify the package

- **WHEN** a manifest declares neither Pi resources nor `release.smoke`
- **THEN** the plan fails for that package before any upload

### Requirement: The declared smoke check verifies the installed tarball

For an upload whose package declares `release.smoke`, the plan SHALL install the tarball into an empty directory exactly as it does for a Pi package (`npm install --omit=peer --no-package-lock <tarball>`, plus `--legacy-peer-deps` when the manifest declares a `dsh` manifest, because npm otherwise resolves that package's `"*"` host peers against the registry and rejects a conflicting prerelease) and SHALL then run `node <worktree>/<package>/<release.smoke> <installed-package-dir>`, where `<worktree>` is the worktree at the version commit, `<package>` is the package directory in that worktree, and `<installed-package-dir>` is the installed copy (`<scratch>/node_modules/<name>`) the Pi load would otherwise receive. The check SHALL pass only when the command exits with status 0; when it exits non-zero, the script's own output SHALL be the failure detail (its stderr, or its stdout when stderr is empty), and the plan SHALL fail before any package of the batch is uploaded. A declared script that is missing from the version commit SHALL fail the plan naming that path. The declared script SHALL run from the worktree at the version commit, never against the checked-out tree or the source directory, so it verifies what the tarball contains.

#### Scenario: A dsh tarball passes its own check

- **WHEN** a version of `@indexyz/dsh-autocompact` is absent from the registry and its declared script exits 0 against the installed copy
- **THEN** the plan records the tarball's SHA-256 and lists it as an upload

#### Scenario: The packaged artifact is broken

- **WHEN** the installed copy fails an invariant the declared script checks
- **THEN** the declared script exits non-zero with a line naming the broken invariant
- **AND** the plan fails and nothing in the batch is uploaded

#### Scenario: The declared script is not runnable

- **WHEN** `node <worktree>/<package>/<release.smoke>` cannot be started, or exits non-zero for any other reason
- **THEN** the plan fails with the script's output as the detail and no package is uploaded

#### Scenario: The declared script is missing from the version commit

- **WHEN** a manifest declares `release.smoke` but the script does not exist in the worktree at that version's commit
- **THEN** the plan fails naming the declared path and no package is uploaded

### Requirement: The Pi load and every other publication step stay as they are

When a package declares no `release.smoke`, the plan SHALL load its installed tarball: `<pi> -ne -e <installed-package-dir> --mode rpc`, answering `get_commands` with `PI_OFFLINE=1` and an empty `PI_CODING_AGENT_DIR`, using the package's own pinned `pi` when present and the worktree's root one otherwise. Whichever check a package uses, version selection, the requirement of exactly one non-empty `## <version>` changelog section at the version commit, tarball inspection against `files` and any `pi` resources, SHA-256 recording, sequential upload with `npm publish <tgz> --access public`, tag and GitHub Release creation, the pull-request release-impact gate, and the workflows SHALL behave exactly as `docs/releases.md` documents them.

#### Scenario: The Pi packages keep the Pi load

- **WHEN** the engine supports `release.smoke` and no `pi-*` manifest declares it
- **THEN** every `pi-*` upload is verified by the in-Pi load

#### Scenario: A declared check does not bypass tarball inspection

- **WHEN** a package declares `release.smoke` and its tarball is missing a `files` entry or contains a `test/` path
- **THEN** tarball inspection fails before the declared script runs

#### Scenario: Records are created for a declared-check package

- **WHEN** a dsh package's upload passes its declared check and reaches the registry
- **THEN** its tag `@indexyz/<name>@<version>` and its GitHub Release are created from its version commit exactly as for a Pi package

### Requirement: A dated section heading names its version

A version's changelog section SHALL be headed `## <version>` or `## <version> - <YYYY-MM-DD>`, the date the section was cut. Both forms SHALL select exactly that version's section, so a version whose section carries a date is verified for upload and recorded with a tag and a Release like any other, and its section body SHALL be that Release's notes. A heading that carries anything else after the version SHALL NOT match, and one version named once bare and once dated SHALL remain the duplicate-section error. The dated history the Pi packages already carry SHALL be read this way, so a run records their missing Releases from those sections.

#### Scenario: a version whose section carries a date

- **WHEN** a package's changelog holds `## 0.1.43 - 2026-10-11` with a body, and the version is absent from npm or its Release is missing
- **THEN** the plan reads that body as the `0.1.43` section: the upload check passes for it, and the missing Release is created from it

#### Scenario: trailing text that is not a date

- **WHEN** a heading reads `## 0.1.43 (unreleased)`, `## 0.1.43-draft`, or `## 0.1.430 - 2026-10-11`, and `0.1.43` needs a section
- **THEN** no section matches, and the version fails as it would with no section at all

#### Scenario: the same version bare and dated

- **WHEN** a changelog holds both `## 0.2.0` and `## 0.2.0 - 2026-10-16` with bodies
- **THEN** the version fails as a duplicate section, naming the count

### Requirement: A Release for an existing tag names no target commitish

When recording a version whose tag already existed, the publish step SHALL create the GitHub Release without a target commitish, because GitHub requires the `workflows` permission — which a GitHub Actions token can never hold — for a Release that names a target SHA whose comparison with the default branch touches `.github/workflows/**`, and the tag the version already carries determines the commit the Release is attached to. Only a tag the same run created SHALL be named as the target, so that a ref the API has not yet observed cannot resolve to the default branch instead. The Release's title, tag, target commit, and body SHALL otherwise be unchanged: the tag `@indexyz/<name>@<version>` and the exact changelog section at the record commit.

#### Scenario: A version whose commit predates a workflow change

- **WHEN** `@indexyz/pi-skill@0.1.43` is on the registry, its tag exists at `b997bd2`, and `main` has changed `.github/workflows/**` since
- **THEN** the Release for that tag is created with no target commitish, from the section at the tag's commit, instead of failing with `HTTP 403: Resource not accessible by integration`

#### Scenario: A tag this run created

- **WHEN** the run has just pushed the tag at the version commit and then creates the Release
- **THEN** the Release names that version commit as its target

#### Scenario: The Release already exists

- **WHEN** the Release for the tag is present
- **THEN** neither a tag nor a Release is created, and no target commitish is sent
