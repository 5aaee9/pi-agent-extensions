# agent-release-workflow Specification

## Purpose

Give agents one procedure for deciding release impact, preparing and reviewing a release locally, handing it over for publication, and reporting the result for this repository's independently versioned packages.

## Requirements

### Requirement: One canonical release runbook

`docs/releases.md` SHALL be the single release procedure. `AGENTS.md` and the `pi-extension-dev` skill SHALL link it rather than restate it, and `docs/workflow.md`, the root `README.md`, and package READMEs SHALL agree with it. The runbook SHALL separate what the agent does locally from what CI does after a push to `main`.

#### Scenario: Agent starts a package change

- **WHEN** an agent reads `AGENTS.md` and loads the `pi-extension-dev` skill
- **THEN** both point to the same runbook for recording intents, preparing versions, and reporting outcomes

### Requirement: Package identity is spelled consistently

Instructions and templates SHALL distinguish the npm name `@indexyz/<name>` (used in intents, the registry, tags, `npm --workspace`, and, for a pi package, `pi install npm:`) from the directory `<name>/` at the repository root (used by the package's OpenSpec root and, for a pi package, `pi -e ./<name>/index.ts`) and from the Conventional Commit scope, which is the directory name without its `pi-` or `dsh-` prefix (`feat(skill): ...`, `fix(autocompact): ...`) and is spelled out when two packages would share it; release preparations use the scope `release` and repository-wide changes use `repo`. Runtime identifiers (commands, settings files) never change with any of these.

#### Scenario: Writing an intent for pi-skill

- **WHEN** an agent records a release decision for the package in `pi-skill/`
- **THEN** the intent names `@indexyz/pi-skill`, the commit uses scope `skill`, and the directory stays `pi-skill/`

### Requirement: Every change records its release decision

In every change that touches a package's published content, the agent SHALL record one decision per affected package before committing: a positive intent with a user-facing summary written from the change itself (never from commit messages), or a `none` intent with the reason no release is needed. Deferring a release SHALL leave a positive intent pending rather than relabeling it `none`. Each intent file SHALL name exactly one package; a change affecting several packages records one file per package, each with its own summary, so that any of them can be excluded from a later preparation.

#### Scenario: Shared fix across two providers

- **WHEN** a change fixes a bug in both `pi-provider-sub2api` and `pi-custom-provider`
- **THEN** the agent records two `patch` intent files, one naming `@indexyz/pi-provider-sub2api` and one naming `@indexyz/pi-custom-provider`, each with a summary describing the user-visible fix

#### Scenario: Development-only change

- **WHEN** a change touches only a package's tests
- **THEN** the agent records no intent and the gate does not ask for one

#### Scenario: Published content reached main without a decision

- **WHEN** a package's published files changed on `main` without an intent (a direct push, or a pull request merged before the gate existed)
- **THEN** the agent records the missing intent in the next pull request, before that package's next release

### Requirement: Releases are prepared locally only on an explicit request

The agent SHALL prepare a release only when asked to release. Preparation SHALL start from an up-to-date `main` with a clean working tree, show the pending intents and the plan, consume all pending intents or exclude named packages, review every changed version and changelog section, commit a release commit (`chore(release): ...`) that contains only release records and reviewed prose, and run the publication plan locally in dry mode on that commit so that a snapshot that would fail verification is caught before it reaches `main`. The agent MUST NOT edit versions or changelog version headings by hand, and MUST NOT prepare a package again while a prepared version of it is unpublished, except to abandon one: a version on `main` that the registry confirms absent and that the workflow has shown cannot ship as it is (its plan failed, or its upload failed for a reason in the package itself), or that was superseded before publication, is left behind, and the next preparation bumps past it; an uncertain upload outcome is retried, never abandoned. A preparation that reached `main` SHALL NOT be reverted to a published version; an unmerged one is rebuilt on its branch.

#### Scenario: Urgent fix with another package pending

- **WHEN** `pi-provider-sub2api` needs an urgent release while `pi-skill` has a pending feature intent
- **THEN** the agent prepares with `pi-skill` excluded, reviews only `pi-provider-sub2api`'s version and notes, and leaves `pi-skill`'s intent pending

#### Scenario: Unpublished preparation needs more changes

- **WHEN** a release commit for `pi-skill@0.2.0` is on a branch but not yet published and another change must join it
- **THEN** the agent reverts the preparation on that branch, lands the new intent, and prepares again instead of bumping to `0.2.1` on top

#### Scenario: Preparation fails verification on main

- **WHEN** `pi-skill@0.2.0` is on `main`, its plan failed before any upload because the snapshot does not load, and nothing was published
- **THEN** the agent lands the fix with its own intent, prepares `pi-skill` again (which bumps to `0.2.1`), and reports `0.2.0` as abandoned
- **AND** the agent does not revert `main` and does not edit the `## 0.2.0` section

### Requirement: Pushing the preparation to main is the publication boundary

Publication SHALL happen only because a release commit reaches `main`; no tag, approval, or manual step follows. A new npm package's bootstrap upload and trusted-publisher setup come before that push (`docs/releases.md`, "First release of a new package"), not after it. The agent MUST NOT push to `main`, merge a release pull request, or dispatch the publish workflow unless the request explicitly asks for that action. A request to implement tooling or to prepare a release is not permission to publish. A push already authorized on the condition of the owner's setup needs no second request.

#### Scenario: Asked to prepare only

- **WHEN** the user asks the agent to prepare a release
- **THEN** the agent commits the preparation on a branch, reports the planned versions, and stops before pushing to `main`

#### Scenario: Asked to release

- **WHEN** the user asks the agent to release and to push
- **THEN** the agent pushes the preparation to `main` (or merges its pull request) and reports the resulting workflow run

### Requirement: Reports distinguish evidence from intent

After a release, the agent SHALL report the release commit, each package's version and outcome (published, already published, failed, not attempted), and whether its tag and GitHub Release exist, taken from the workflow run. Local checks, dry runs, and plans MUST NOT be reported as publications. For an incomplete batch the agent SHALL rerun the same workflow run or dispatch the workflow on `main`, never bump versions to retry.

#### Scenario: One of two packages failed

- **WHEN** the publish job published `pi-skill` and failed on `pi-continue`
- **THEN** the agent reports both states and reruns the workflow after the cause is fixed outside the repository, or, if the package itself is at fault, abandons the failed version and prepares the next one with the fix

#### Scenario: Local dry run

- **WHEN** the agent previews a preparation without pushing
- **THEN** its report states that nothing was published

### Requirement: The runbook covers both package classes

`docs/releases.md` SHALL stay the single release procedure for both classes and SHALL NOT state a package count that the workspace no longer has; the historical rows that describe the first run after adoption (the six `0.1.43` tags at `b997bd2`) keep their meaning as the record of that run. Its identity table SHALL name the dsh directory (`dsh-<topic>/`, loaded by a dsh profile and not by `pi -e`), the npm name `@indexyz/dsh-<topic>`, the Conventional Commit scope (the directory name without its class prefix, so `autocompact` for `dsh-autocompact`, spelled out when a `pi-<topic>/` package would share it; `release` for preparations and `repo` for repository-wide changes), and the tag form `@indexyz/<name>@<version>`. Its "What CI does" section SHALL state that verification uses either the in-Pi load or the check a package declares with `release.smoke`, and SHALL have a section for the package a Pi load cannot verify that documents the declared check: a relative `.ts` path, run from the version commit's worktree with the installed package directory as its only argument, which must exit 0 and whose own output is the failure detail, and which replaces the Pi load and nothing else. Its activation table's trusted-publisher row SHALL cover every published package, including a new one, configured after its `0.0.0` bootstrap upload and before its first formal push. Its "First release of a new package" section SHALL be the procedure for every new npm package of either class: the agent prepares an independent empty `0.0.0` workspace outside the repository, the owner publishes it with the `bootstrap` tag and configures the trusted publisher, and the verified formal version is then pushed so CI publishes and records it; agents never perform the owner's steps. Everything else — intents, the gate table, local preparation, the no-op and failure tables, report, retry, and the abandonment rule — SHALL keep its current meaning for both classes.

#### Scenario: A dsh release decision

- **WHEN** an agent records a decision for a change to `dsh-autocompact/`
- **THEN** the runbook tells it the intent names `@indexyz/dsh-autocompact`, the commit scope is `autocompact`, and the directory stays `dsh-autocompact/`

#### Scenario: Verification of a dsh package is documented

- **WHEN** the runbook's "What CI does" section is read for a package that declares `release.smoke`
- **THEN** it says the installed tarball is verified by that declared script instead of the Pi load, and that every other step is unchanged

#### Scenario: The first release needs the owner

- **WHEN** a package has never been published
- **THEN** the runbook's first-release section is the procedure: the owner publishes the empty bootstrap package and adds the trusted publisher, after which CI publishes the formal version and records its tag and Release

#### Scenario: The Pi packages' procedure is unchanged

- **WHEN** an agent prepares a release for a `pi-*` package
- **THEN** every step, gate row, and failure row it uses is the one it used before this change
