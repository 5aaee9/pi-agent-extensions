# Releases

How packages in this repository are versioned and published. Agents decide what ships by writing release intents and preparing versions locally; CI only publishes and records what a commit on `main` already contains. This is the single procedure; `AGENTS.md`, the `pi-extension-dev` skill, and `docs/workflow.md` link here.

| Who                                     | Does                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Agent, in feature work                  | Records a release decision for every package whose published content changed                                                             |
| Agent, at release time (on request)     | Prepares versions and changelogs locally, reviews them, verifies them with a dry-run plan, commits the preparation                       |
| Owner (or an agent explicitly asked to) | Pushes the preparation to `main`, directly or by merging its pull request; that push is the publication boundary                         |
| CI (`publish.yml`)                      | Publishes every package version absent from npm, built from the commit that introduced it, then creates missing tags and GitHub Releases |

CI never chooses versions, consumes intents, writes release notes, or selects packages beyond "the current version is not on npm".

## Identity

Every package publishes as `@indexyz/<name>` from the root-level directory `<name>/`: `@indexyz/pi-skill` lives in `pi-skill/`.

| Use                                                                                    | Form                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Directory, `pi -e ./<name>/index.ts`, package OpenSpec root                            | `pi-skill/`                                                                                  |
| `package.json` `name`, release intents, registry, `npm --workspace`, `pi install npm:` | `@indexyz/pi-skill`                                                                          |
| Conventional Commit scope (no versioning role)                                         | `skill` (`feat(skill): ...`); `release` for preparations, `repo` for repository-wide changes |
| Tags and GitHub Releases                                                               | `@indexyz/pi-skill@0.1.44`                                                                   |

Runtime identifiers (commands, settings files, session entry types) never change with any of these. The private workspace root is never versioned or published (changesets `privatePackages` is off for it).

Versions are independent per package. There is no repository version, and no `v<version>` tag is created any more; the existing `v*` tags stay as history and pushing one publishes nothing.

## Tooling

- `.changeset/<id>.md`: release intents. `.changeset/config.json` configures [changesets](https://github.com/changesets/changesets), which owns intents, version bumps, and changelog sections (`npm run change`, `npm run change:status`, `npm run release:version`). `.changeset/changelog.mjs` renders each intent summary as a `- <summary>` bullet.
- `scripts/release/gate.mjs`: the pull-request release-impact gate (`npm run release:gate`).
- `scripts/release/plan.mjs`: the read-only publication plan, also run locally with `--dry-run`.
- `scripts/release/publish.mjs`: uploads and records; only CI runs it.
- `scripts/release/version-commit.mjs`: prints the commit that introduced each package's current version.

Changesets' own `publish`, `pack`, and `git-tag` commands are not used.

## 1. Record a release decision in every change

A package needs a decision when a change touches its published content: its `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, or any path listed in its `files`. Tests, the package's `openspec/`, `tsconfig.json`, `vitest.config.ts`, root tooling, and repository docs need none.

Record a release with changesets, one package per command:

```bash
npm run change -- --patch @indexyz/pi-skill -m "Leave unknown skill tokens in the prompt unchanged."
npm run change -- --minor @indexyz/pi-continue -m "Add /continue --model to resume with a different model."
```

Record "no release" by writing the intent by hand (the changesets CLI has no flag for `none`, and `changeset add --empty` names no package, so it would count for no package). Create `.changeset/<short-descriptive-id>.md`:

```md
---
"@indexyz/pi-skill": none
---

README wording only; nothing to ship.
```

- A positive intent (`patch`, `minor`, `major`) means the change should eventually ship. It does not force the next release; it stays pending until a preparation consumes it. To defer a release, leave it pending; never relabel it `none`.
- `none` explains why a change needs no release. It never causes a version change or publication, and the next preparation deletes it.
- Write the summary for users, from the change itself, never from commit messages. It becomes the changelog entry. Every intent needs a summary.
- One intent file names exactly one package. A change affecting two packages records two files, each with its own summary (run `npm run change` twice; never `--patch a,b`). Subset preparation (`--ignore`) fails on a file that names both an ignored and a selected package, and the gate rejects such files.
- Commit the intent with the change.
- `npm run change:status` lists pending intents and the versions they imply. It is a local command only: it exits with an error on a branch that changed package files and has no intent files at all (including tests-only branches), so CI never runs it.

Published content that reached `main` without a decision (a direct push, or a pull request merged before the gate existed) gets its intent in the next pull request, before that package's next release.

### The release-impact gate

`lint.yml` runs `node scripts/release/gate.mjs --base <base sha> --head <head sha>` on every pull request. It compares the head with its merge base and first validates every intent file at the head: parseable front matter, exactly one package, a publishable workspace package name, and a non-empty summary.

| Pull request contains, for a package                                                                                                                                                               | Gate                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Published changes and no intent naming the package added or modified by the pull request                                                                                                           | fails, naming the package, the files, and the commands that record a decision |
| Published changes and only an intent already pending on the base branch                                                                                                                            | fails; old intents never cover new changes                                    |
| A new or modified intent naming the package (`none` included)                                                                                                                                      | passes                                                                        |
| A preparation: version changed, a new `## <version>` section, a consumed (deleted) intent naming the package, and no published file changed other than `package.json`, `CHANGELOG.md`, `README.md` | passes without a new intent                                                   |
| A preparation plus other published changes (source files)                                                                                                                                          | fails unless an intent naming the package is also added or modified           |
| A version change without the other preparation signs (with or without an intent)                                                                                                                   | fails                                                                         |
| Only tests, `openspec/`, root tooling, or docs                                                                                                                                                     | passes without a decision                                                     |
| An intent file that names two packages, an unknown package, or has no summary                                                                                                                      | fails                                                                         |

The gate verifies that a decision exists; it does not judge the bump type. External pull requests get the same gate: a maintainer or agent adds the intent to the contributor's branch, or in a follow-up commit before merging.

## 2. Prepare a release locally

Do this only on an explicit release request. Source changes and their intents must already be on `main`; the preparation contains only release records and reviewed prose.

1. Start from an up-to-date `main` with a clean working tree:

   ```bash
   git switch main
   git pull --ff-only
   git status --short
   git switch -c release/<yyyy-mm-dd>
   ```

2. Inspect what is pending: `npm run change:status`. Use `npx changeset status --verbose` to see which intent files cause each bump.
3. Consume the intents, all of them or all but excluded packages (repeat `--ignore` per package):

   ```bash
   npm run release:version
   npm run release:version -- --ignore @indexyz/pi-skill
   ```

   For each selected package with a positive intent this bumps `package.json` to the highest pending bump, inserts a `## <version>` section with `### Major Changes` / `### Minor Changes` / `### Patch Changes` lists above the first existing version heading, and deletes the consumed intents. `none` intents of selected packages are deleted without a version change. Excluded packages' intents stay untouched.

4. Refresh the workspace versions recorded in the lockfile:

   ```bash
   npm install --package-lock-only
   ```

5. Review before committing: every manifest version, every new `CHANGELOG.md` section, the consumed and remaining intent files, and the lockfile diff (only the bumped packages' `version` entries should change). Edit the section prose freely; keep its `## <version>` heading and never edit versions by hand. A README update that belongs to the release may join the preparation.
6. Run `npm run check`. The publish workflow runs it on `main` before planning, so a preparation that fails it (for example a generated section that does not pass `format:check`) blocks every upload, and a direct push to `main` skips `lint.yml`.
7. Commit: `chore(release): prepare @indexyz/pi-skill 0.2.0` (name every prepared package and version).
8. Verify the snapshot exactly as CI will:

   ```bash
   node scripts/release/plan.mjs --dry-run
   ```

   It plans from `HEAD`: for every prepared version it builds the tarball at that version's commit, inspects it, installs it in isolation, and loads it in Pi. It needs network access (npm registry, `git fetch` from `origin`, and `gh` when available) and writes nothing to the registry or GitHub; without GitHub access it reports Release state as unknown. Fix any failure by revising the preparation on the branch (below) before handing it over.

9. Hand over: report the planned versions and the dry-run result, and stop. Push the branch, open a pull request, push to `main`, or merge only when the request explicitly asks for that action. A request to prepare a release is not permission to publish.

### Do not stack preparations

Changesets bumps from the current manifest version, so preparing a package again while a prepared version of it is unpublished would skip that version and leave a section no run will ever publish. Therefore:

- To revise an unmerged preparation, rebuild it: reset the release branch to `main` (or revert the preparation commit on it), land any new or revised intents on `main` first, and prepare again.
- After a preparation reaches `main`, finish its publication (Retry) before preparing that package again.
- Retrying a publication never runs `npm run release:version`.

The one exception is an **abandoned** version. A version on `main` may be abandoned only when the registry confirms it absent and the workflow has shown it cannot ship as it is: its plan failed (a `files` entry that does not exist, a failing load, a missing or duplicate section), or its upload failed for a reason in the package itself. A version superseded by a second preparation before it was published is abandoned the same way. Leave an abandoned version behind: land the fix with its own intent, and the next preparation bumps past it (`0.2.0` abandoned, `0.2.1` prepared). The dangling `## <abandoned version>` section stays in the changelog as history; do not edit or delete it. An uncertain upload outcome (a timeout, a registry error, anything that may have reached npm) is retried, never abandoned. `main` is never reverted to a published version to undo a preparation.

## 3. What CI does

`.github/workflows/publish.yml` runs on every push to `main` and on manual dispatch from `main`. A dispatch from any other ref fails at its first step. Runs share the concurrency group `npm-release` and never cancel each other. Tags do not trigger it.

The **version commit** of a package's current version is the newest commit on the first-parent history of `main` whose `<name>/package.json` carries that version while its first parent's does not (`node scripts/release/version-commit.mjs` prints it). For a squash or merge commit it is the integration commit; for a rebase merge or direct push, the commit that changed the version. Everything about a version comes from its version commit: the tarball, the changelog section, the tag target, and the Release notes. A later commit that changes the package without changing its version never changes what that version publishes.

1. **Plan** (permissions `contents: read`, no publishing credentials): `npm ci`, `npm run check`, then `node scripts/release/plan.mjs --out <dir>`:
   - validates every intent file on disk;
   - for every package: its version commit, whether the version is on npm (`npm view`; a 404 means absent, any other failure fails the run), its tag `@indexyz/<name>@<version>` (an existing tag is accepted when its commit's manifest carries the version; otherwise the run fails), its GitHub Release, and the exact `## <version>` changelog section;
   - **uploads** are the versions absent from npm. Each needs exactly one non-empty `## <version>` section at its version commit. Each is built in a `git worktree` at its version commit: `npm ci`, `npm pack --workspace <name>` (whose `prepack` runs the package's typecheck and tests on that snapshot), inspection of the tarball (manifest name and version, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, every `files` and `pi` path, nothing under `test/` or `openspec/`), an install with `npm install --omit=peer` into an empty directory, and a load of the installed copy with that snapshot's `pi` (`-ne --mode rpc`, answering `get_commands`, `PI_OFFLINE=1`, empty `PI_CODING_AGENT_DIR`). The tarball's SHA-256 goes into `release-plan.json`;
   - **record work** is every published (or uploading) version whose tag is missing, or whose GitHub Release is missing while an exact section exists;
   - with at least one upload or record item, it uploads the `release-batch` artifact and lets the publish job run. Any failure blocks the whole batch.
2. **Publish** (permissions `contents: write` and `id-token: write`; the only job with OIDC): `node scripts/release/publish.mjs --dir <dir>`:
   - checks every tarball against its planned SHA-256, then uploads one at a time with `npm publish <tgz> --access public` through npm trusted publishing (no token is stored anywhere). A version that reached npm in the meantime ("cannot publish over the previously published versions") counts as published after a registry re-check; any other failure stops further uploads;
   - then, for every record item and every version uploaded in this run that npm confirms: creates the tag as a lightweight tag at the version commit when missing and pushes exactly that ref; creates the GitHub Release (title and tag `@indexyz/<name>@<version>`, body = the exact changelog section) when missing and the section exists. Existing tags and Releases are left as they are; a tag at a commit that does not carry the version is an error and is never moved. When an accepted tag points at an older commit carrying the version (after a revert), the Release is created from that commit;
   - prints a report table (also written to the run summary) and fails when any upload or record failed.

Two packages released from one commit get two tags on that commit; that does not imply a shared version. npm provenance names the workflow run's commit (`github.sha`), which after a retry on an advanced `main` is later than the version commit the tarball was built from; the tag and Release name the version commit.

### No-op or failure

| Situation                                                                                                                                     | Result                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Push with every version on npm, tagged, and released where an exact section exists (docs, source, intents)                                    | plan succeeds; publish job skipped                                                                                                                                                                                 |
| First run after adoption: every package at `0.1.43`, published, untagged, with dated `## 0.1.43 - 2026-10-11` headings                        | six `@indexyz/<name>@0.1.43` tags created at `b997bd2`; no Releases; later runs are no-ops                                                                                                                         |
| Malformed intent file, unreadable history, registry lookup failure other than 404                                                             | failure before any upload                                                                                                                                                                                          |
| Absent version without exactly one non-empty `## <version>` section at its version commit (hand-bumped, missing, empty, or duplicate section) | failure before any upload                                                                                                                                                                                          |
| Absent version whose tarball inspection, isolated install, or Pi load fails                                                                   | failure before any upload                                                                                                                                                                                          |
| `npm ci` fails in the worktree because the version commit's lockfile is out of sync with its manifests                                        | failure before any upload; the version cannot ship as it is and is abandoned (Retry)                                                                                                                               |
| Tag `@indexyz/<name>@<version>` at a commit whose manifest carries another version                                                            | failure; the tag is never moved, the owner investigates                                                                                                                                                            |
| A current version fails plan verification                                                                                                     | every push's plan fails on it, so no other package is uploaded or recorded until the fix and the next preparation for that package land on `main` (two pushes: the gate keeps source changes out of a preparation) |
| An upload npm rejects (other than "already published")                                                                                        | later uploads in that run are not attempted; versions already on npm are still recorded; the job fails                                                                                                             |
| A tag push or Release creation fails                                                                                                          | the job fails; a rerun creates what is still missing                                                                                                                                                               |

## 4. Report

After a release push, report from the workflow run, not from local checks: the release commit, each package's version and outcome (published, already published, failed, not attempted), and whether its tag and GitHub Release exist. Local checks, dry runs, and plans are never reported as publications.

## 5. Retry

Never change versions, prepare again, unpublish, or overwrite to retry. Fix published defects with a new forward release.

1. Rerun the original workflow run (all jobs, or the failed jobs only, which reuses the verified artifact). It recomputes from committed state: versions already on npm are skipped, missing versions are uploaded from their own commits, and missing tags and Releases are created.
2. Or dispatch the workflow on `main`: `gh workflow run publish.yml --ref main`. It plans from the current `main` head and converges the same way: tags still point at each version's commit, not at the head.
3. If the failure was caused by the package itself (the plan rejected the snapshot, or npm rejected the tarball's content), the version cannot be repaired in place: abandon it as described in "Do not stack preparations", land the fix with its own intent, and prepare the next version.

## First release of a new package

npm configures a trusted publisher in an existing package's settings, so a package that has never been published cannot be uploaded by CI. Its first version is published once by the owner:

1. Push the preparation that sets the package's first version as usual. The run plans and verifies it and uploads the `release-batch` artifact; its publish job then fails at that upload.
2. Download the verified artifact (`gh run download <run-id> -n release-batch`) and compare the tarball with `release-plan.json` (`shasum -a 256 <tgz>`).
3. The owner publishes exactly that tarball with their npm login: `npm publish <tgz> --access public`.
4. Add the trusted publisher for the new package (below), then rerun the failed jobs; the run finds the version on npm, skips the upload, and creates the tag and Release.

Agents never perform this bootstrap.

## Activation

Each item is checked by the owner; missing items are reported, never guessed.

| Item                                                                                                                                                                   | Check                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Trusted publisher for each of the six packages: owner `5aaee9`, repository `pi-agent-extensions`, workflow `publish.yml`, no environment, allowed action `npm publish` | each package's settings on npmjs.com; unchanged by this setup                                                             |
| The publish job has no GitHub `environment` and is the only job with `id-token: write`                                                                                 | `.github/workflows/publish.yml`                                                                                           |
| The publish job can push tags and create Releases                                                                                                                      | `contents: write` on that job; `GH_TOKEN` is the run's `github.token`                                                     |
| The first run tags `0.1.43` by itself                                                                                                                                  | after the adoption merge, `git ls-remote --tags origin '@indexyz/*'` lists six `@indexyz/<name>@0.1.43` tags at `b997bd2` |

`main` has no branch protection today, so pushing to it publishes. Whether to require pull requests for `main` is the owner's decision; this procedure works with both direct pushes and merges.
