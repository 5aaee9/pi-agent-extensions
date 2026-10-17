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

A `dsh-<topic>/` package follows the same forms with its own prefix: `@indexyz/dsh-autocompact` lives in `dsh-autocompact/`, its commit scope is `autocompact` (spelled out, `dsh-autocompact`, when a `pi-<topic>/` package would share it), and its tags read `@indexyz/dsh-autocompact@0.1.0`. It is not a Pi extension, so `pi -e` and `pi install npm:` do not apply to it; `docs/architecture.md` covers how a dsh profile installs it.

Versions are independent per package. There is no repository version, and no `v<version>` tag is created any more; the existing `v*` tags stay as history and pushing one publishes nothing.

## Tooling

- `.changeset/<id>.md`: release intents. `.changeset/config.json` configures [changesets](https://github.com/changesets/changesets), which owns intents, version bumps, and changelog sections (`npm run change`, `npm run change:status`, `npm run release:version`). `.changeset/changelog.ts` renders each intent summary as a `- <summary>` bullet.
- `scripts/release/gate.ts`: the pull-request release-impact gate (`npm run release:gate`).
- `scripts/release/plan.ts`: the read-only publication plan, also run locally with `--dry-run`.
- `scripts/release/publish.ts`: uploads and records; only CI runs it.
- `scripts/release/version-commit.ts`: prints the commit that introduced each package's current version.

Changesets' own `publish`, `pack`, and `git-tag` commands are not used.

## 1. Record a release decision in every change

A package needs a decision when a change touches its published content: its `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, or any path listed in its `files`. For a package declaring a `dsh` manifest, the gate also counts build inputs: root `.ts`/`.tsx` runtime modules (excluding `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, and `vitest.config.ts`), everything under `src/`, root `tsconfig*.json`, and `tsdown.config.ts`. Those inputs can change the published runtime even though `lib/` and `client.js` are Git-ignored. Update this convention and the gate together if a package introduces other build-input locations.

Unpublished tests, the package's `openspec/`, `vitest.config.ts`, root tooling, and repository docs need no decision. Pi packages retain the published-path rule, so their unpublished `tsconfig.json` changes need none.

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

`lint.yml` runs `node scripts/release/gate.ts --base <base sha> --head <head sha>` on every pull request. It compares the head with its merge base and first validates every intent file at the head: parseable front matter, exactly one package, a publishable workspace package name, and a non-empty summary.

| Pull request contains, for a package                                                                                                                                                                                                                                     | Gate                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Published changes and no intent naming the package added or modified by the pull request                                                                                                                                                                                 | fails, naming the package, the files, and the commands that record a decision |
| Published changes and only an intent already pending on the base branch                                                                                                                                                                                                  | fails; old intents never cover new changes                                    |
| A new or modified intent naming the package (`none` included)                                                                                                                                                                                                            | passes                                                                        |
| A preparation: version changed, a new `## <version>` section, a consumed (deleted) `patch`, `minor`, or `major` intent naming the package (a deleted `none` intent does not count), and no published file changed other than `package.json`, `CHANGELOG.md`, `README.md` | passes without a new intent                                                   |
| A preparation plus other published changes (source files)                                                                                                                                                                                                                | fails unless an intent naming the package is also added or modified           |
| A version change without the other preparation signs (with or without an intent)                                                                                                                                                                                         | fails                                                                         |
| Only tests, `openspec/`, root tooling, or docs                                                                                                                                                                                                                           | passes without a decision                                                     |
| An intent file that names two packages, an unknown package, or has no summary                                                                                                                                                                                            | fails                                                                         |

The gate verifies that a decision exists; it does not judge the bump type. External pull requests get the same gate: a maintainer or agent adds the intent to the contributor's branch, or in a follow-up commit before merging.

## 2. Prepare a release locally

Do this only on an explicit release request. Source changes and their intents must already be on local `main`; the preparation contains only release records and reviewed prose. For a new npm package, follow [First release of a new package](#first-release-of-a-new-package): prepare locally, but keep its commits off GitHub until the owner has published the empty bootstrap package and configured Trusted Publisher.

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
   node scripts/release/plan.ts --dry-run
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

The **version commit** of a package's current version is the newest commit on the first-parent history of `main` whose `<name>/package.json` carries that version while its first parent's does not (`node scripts/release/version-commit.ts` prints it). For a squash or merge commit it is the integration commit; for a rebase merge or direct push, the commit that changed the version. Everything about a version comes from its version commit: the tarball, the changelog section, the tag target, and the Release notes. A later commit that changes the package without changing its version never changes what that version publishes.

1. **Plan** (permissions `contents: read`, no publishing credentials): `npm ci`, `npm run check`, then `node scripts/release/plan.ts --out <dir>`:
   - validates every intent file on disk;
   - for every package: its version commit, whether the version is on npm (`npm view`; a 404 means absent, any other failure fails the run), its tag `@indexyz/<name>@<version>` (an existing tag is accepted when its commit's manifest carries the version; otherwise the run fails), its GitHub Release, and its `## <version>` changelog section (a date after the version belongs to the heading, not to the version);
   - **uploads** are the versions absent from npm. Each needs exactly one non-empty section for its version at its version commit, headed `## <version>` or, as the pre-adoption history does, `## <version> - <YYYY-MM-DD>` with the date it was cut. Each is built in a `git worktree` at its version commit: `npm ci`, `npm pack --workspace <name>` (whose `prepack` runs the package's typecheck, build and tests on that snapshot), inspection of the tarball (manifest name and version, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, every `files` and `pi` path, nothing under `test/` or `openspec/`), an install with `npm install --omit=peer` into an empty directory (`--legacy-peer-deps` as well for a package with a `dsh` manifest), and a load of the installed copy with that snapshot's `pi` (`-ne --mode rpc`, answering `get_commands`, `PI_OFFLINE=1`, empty `PI_CODING_AGENT_DIR`) — or, for a package that declares `release.smoke`, the check described in "Packages Pi does not load". The tarball's SHA-256 goes into `release-plan.json`;
   - **record work** is every published (or uploading) version whose tag is missing, or whose GitHub Release is missing while an exact section exists;
   - with at least one upload or record item, it uploads the `release-batch` artifact and lets the publish job run. Any failure blocks the whole batch.
2. **Publish** (permissions `contents: write` and `id-token: write`; the only job with OIDC): `node scripts/release/publish.ts --dir <dir>`:
   - checks every tarball against its planned SHA-256, then uploads one at a time with `npm publish <tgz> --access public` through npm trusted publishing (no token is stored anywhere). A version that reached npm in the meantime ("cannot publish over the previously published versions") counts as published after a registry re-check; any other failure stops further uploads;
   - waits out registry propagation: `npm publish` can succeed before the registry serves the version, so a version this run uploaded that `npm view` does not confirm is re-checked on an exponential backoff (5 s, 10 s, 20 s, ... capped at 2 minutes) until it appears. The whole run shares one 30-minute budget, established at the first wait and never extended, and every wait is clamped to what is left of it, so a run never waits longer than 30 minutes however many versions it waits for. Every lookup revalidates with `--prefer-online`, because a cached package document from before the upload would keep answering that the version is absent. A version the registry still does not serve when the budget is exhausted fails the run without being recorded, so the rerun below remains the backstop; a version that is genuinely absent — an upload that failed for another reason, or was not attempted because an earlier upload failed — is looked up once and never waited for, and a lookup that errors is not treated as absence;
   - then, for every record item and every version uploaded in this run that npm confirms: creates the tag as a lightweight tag at the version commit when missing and pushes exactly that ref; creates the GitHub Release (title and tag `@indexyz/<name>@<version>`, body = the exact changelog section) when missing and the section exists. Existing tags and Releases are left as they are; a tag at a commit that does not carry the version is an error and is never moved. When an accepted tag points at an older commit carrying the version (after a revert), the Release is created from that commit; a Release for a tag that already existed names no target commitish at all, because GitHub refuses a Release whose target SHA compares to the default branch with `.github/workflows/**` changes unless the caller holds the `workflows` permission, which the Actions token can never have, and the tag itself already decides the commit. Only a tag this run pushed is passed as the target, so a ref the API has not seen yet cannot resolve to the default branch instead;
   - prints a report table (also written to the run summary) and fails when any upload or record failed.

Two packages released from one commit get two tags on that commit; that does not imply a shared version. npm provenance names the workflow run's commit (`github.sha`), which after a retry on an advanced `main` is later than the version commit the tarball was built from; the tag and Release name the version commit.

### No-op or failure

| Situation                                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push with every version on npm, tagged, and released where an exact section exists (docs, source, intents)                                                                                      | plan succeeds; publish job skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| First run after adoption: every package at `0.1.43`, published, untagged, with dated `## 0.1.43 - 2026-10-11` headings                                                                          | CI could not create those tags — `b997bd2` predates the workflow changes the adoption merge brought to `main`, and the receive hook refuses a new ref there (`refusing to allow a GitHub App to create or update workflow .github/workflows/lint.yml without workflows permission`) — so the owner pushed the six `@indexyz/<name>@0.1.43` tags with a `workflow`-scoped token. The run created no Releases because a dated heading was then read as no section at all; it is now read as that version's section, so a rerun records the missing Releases from those headings |
| Malformed intent file, unreadable history, registry lookup failure other than 404                                                                                                               | failure before any upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Absent version without exactly one non-empty section for it at its version commit (hand-bumped, missing, empty, duplicate, or a heading carrying anything but the version and an optional date) | failure before any upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Absent version whose tarball inspection, isolated install, or Pi load fails                                                                                                                     | failure before any upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm ci` fails in the worktree because the version commit's lockfile is out of sync with its manifests                                                                                          | failure before any upload; the version cannot ship as it is and is abandoned (Retry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tag `@indexyz/<name>@<version>` at a commit whose manifest carries another version                                                                                                              | failure; the tag is never moved, the owner investigates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A version commit that predates a `.github/workflows/**` change on `main`, so its comparison with `main` touches a workflow file                                                                 | CI can neither push that tag (the receive hook refuses the ref) nor name it as a Release target: the Actions token can never hold the `workflows` permission. The owner pushes that one tag once with a `workflow`-scoped token; the next run records its Release from the tag itself, naming no target commitish. A Release created with such a target SHA answers `HTTP 403: Resource not accessible by integration`                                                                                                                                                        |
| A current version fails plan verification                                                                                                                                                       | every push's plan fails on it, so no other package is uploaded or recorded until the fix and the next preparation for that package land on `main` (two pushes: the gate keeps source changes out of a preparation)                                                                                                                                                                                                                                                                                                                                                            |
| An upload npm rejects (other than "already published")                                                                                                                                          | later uploads in that run are not attempted; versions already on npm are still recorded; the job fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| An upload succeeded but npm does not show the version yet (registry propagation)                                                                                                                | the job waits for the version on an exponential backoff under one 30-minute budget shared by the run, then creates the tag and Release as soon as the registry serves it; a version still unserved when the budget is exhausted fails without being recorded, so a rerun finds it published and creates the missing records                                                                                                                                                                                                                                                   |
| A tag push or Release creation fails                                                                                                                                                            | the job fails; a rerun creates what is still missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 4. Report

After a release push, report from the workflow run, not from local checks: the release commit, each package's version and outcome (published, already published, failed, not attempted), and whether its tag and GitHub Release exist. Local checks, dry runs, and plans are never reported as publications.

## 5. Retry

Never change versions, prepare again, unpublish, or overwrite to retry. Fix published defects with a new forward release.

1. Rerun the original workflow run (all jobs, or the failed jobs only, which reuses the verified artifact). It recomputes from committed state: versions already on npm are skipped, missing versions are uploaded from their own commits, and missing tags and Releases are created.
2. Or dispatch the workflow on `main`: `gh workflow run publish.yml --ref main`. It plans from the current `main` head and converges the same way: tags still point at each version's commit, not at the head.
3. If the failure was caused by the package itself (the plan rejected the snapshot, or npm rejected the tarball's content), the version cannot be repaired in place: abandon it as described in "Do not stack preparations", land the fix with its own intent, and prepare the next version.

## Packages Pi does not load

Every non-private workspace package is a release candidate, and the plan verifies each one by loading its installed tarball in Pi. A package Pi cannot load — a `dsh-<topic>/` package is a Cordis plugin for the DeepSeek Harness, not a Pi extension — declares its own check in its manifest instead:

```json
"release": { "smoke": "test/smoke-release.ts" }
```

The script is a relative `.ts` path, runs from the version commit's worktree under `node` with the installed package directory as its only argument, and must exit 0; its own output is the failure detail shown when it does not. It is the package's replacement for the Pi load and nothing else: the tarball inspection, the isolated install, the version, the upload, the tag and the Release are unchanged. A package that declares neither Pi resources nor `release.smoke` fails its plan, naming both, because nothing would verify what it publishes.

Such a package also declares its host packages as `"*"` peers, and npm resolves peers against the registry while installing the tarball, which fails when those prereleases conflict. So a package with a `dsh` manifest is installed with `--omit=peer --legacy-peer-deps` instead of `--omit=peer`: the tarball still lands alone in the empty directory, and the declared check decides whether what landed is usable. Every other package is installed exactly as before.

A dsh package's script is expected to check what its host will actually load — for `dsh-autocompact` that is the packaged `client.js` evaluated against the Harness module-loader contract, plus the presence of the built host entry the manifest points at. Hand verification runs the same script.

## First release of a new package

npm configures a Trusted Publisher in an existing package's settings. Every new npm package in this repository, including both `pi-*` and `dsh-*`, therefore follows this order: **prepare an independent empty workspace → the owner publishes its bootstrap package → the owner configures Trusted Publisher → push the verified formal release to GitHub → CI publishes and records the formal version**.

Local source commits, release preparation and dry-run verification may proceed while the owner completes the npm setup. Keep the new package's commits local until the owner confirms that both the bootstrap publication and Trusted Publisher configuration are complete. The first GitHub push containing the new package must carry its prepared formal version, normally `0.1.0`, with its complete artifacts and release notes.

### 1. Prepare the empty workspace

The agent creates a separate directory **outside the Git checkout and its npm workspaces**, using the same npm package name as the formal package. Its version is `0.0.0`, and its publish tag is `bootstrap`; reserve `0.1.0` for the functional package. Include only `package.json`, a short README explaining the placeholder, and the project's license. Do not include runtime code, dependencies, lifecycle scripts, or a `pi`/`dsh` manifest, and do not copy the bootstrap tag into the formal package's publish configuration.

Replace `<name>` with the full directory name, including its `pi-` or `dsh-` prefix:

```json
{
  "name": "@indexyz/<name>",
  "version": "0.0.0",
  "description": "Bootstrap placeholder for configuring npm trusted publishing",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/5aaee9/pi-agent-extensions.git",
    "directory": "<name>"
  },
  "publishConfig": {
    "access": "public",
    "tag": "bootstrap"
  },
  "files": ["README.md", "LICENSE"]
}
```

Check the package's npm registry state first. A 404 means the package is absent; other registry errors do not. For a package that already exists, inspect its published versions and publisher setup instead of trying to publish `0.0.0` again. Run `npm pack --dry-run` in the empty workspace and verify that only the three intended files would ship. Hand the owner the directory or packed tarball, the commands below, and the publisher fields.

### 2. The owner publishes the bootstrap package

The owner runs these commands in the empty workspace, using their own npm login:

```bash
npm login
npm publish --access public --tag bootstrap
```

Confirm that the registry serves the placeholder:

```bash
npm view '@indexyz/<name>@0.0.0' version --prefer-online
```

The empty workspace stays outside the repository. Its `0.0.0` publication establishes the npm package for configuration; it is not the formal plugin release and must not consume the formal version number.

### 3. The owner configures Trusted Publisher

In the new npm package's settings, add a GitHub Actions Trusted Publisher:

| Field                    | Value                 |
| ------------------------ | --------------------- |
| Organization or user     | `5aaee9`              |
| Repository               | `pi-agent-extensions` |
| Workflow filename        | `publish.yml`         |
| Environment              | Leave empty           |
| Allowed action, if shown | `npm publish`         |

The publish job already declares `id-token: write` and has no GitHub environment. No npm token is added to the repository. The owner confirms that both the bootstrap upload and this configuration are complete; package existence alone does not prove that trusted publishing is configured.

### 4. Push and verify the formal release

After that confirmation, finish the normal local checks and `node scripts/release/plan.ts --dry-run` against the formal version's commit. Carry out an already-authorized push or merge to GitHub `main`; if publication has not been authorized, hand over the verified preparation instead. Do not request the same authorization again when it was already given conditional on the owner's setup.

CI publishes the functional version through Trusted Publisher, then creates its `@indexyz/<name>@<version>` tag and GitHub Release. Follow the workflow to completion and verify all three results. Report the bootstrap upload and formal release separately. If the workflow fails, use the normal retry procedure without changing the formal version merely to retry.

Agents prepare and verify the empty workspace and the formal release. The owner performs the bootstrap `npm publish` and configures npm Trusted Publisher. This sequence replaces the previous procedure that deliberately let CI's first upload fail and then had the owner publish the formal tarball by hand.

## Activation

Each item is checked by the owner; missing items are reported, never guessed.

| Item                                                                                                                                                                                                                                                                      | Check                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted publisher for every published package; for a new package, configured after its `0.0.0` bootstrap upload and before the formal GitHub push: owner `5aaee9`, repository `pi-agent-extensions`, workflow `publish.yml`, no environment, allowed action `npm publish` | owner confirms the fields in each package's settings on npmjs.com before the first formal push                                                                                                        |
| The publish job has no GitHub `environment` and is the only job with `id-token: write`                                                                                                                                                                                    | `.github/workflows/publish.yml`                                                                                                                                                                       |
| The publish job can push tags and create Releases                                                                                                                                                                                                                         | `contents: write` on that job; `GH_TOKEN` is the run's `github.token`                                                                                                                                 |
| The first run tags `0.1.43`                                                                                                                                                                                                                                               | those six tags exist at `b997bd2`, pushed once with a `workflow`-scoped token because CI cannot create a ref at a commit that predates a workflow change (`git ls-remote --tags origin '@indexyz/*'`) |

`main` has no branch protection today, so pushing to it publishes. Whether to require pull requests for `main` is the owner's decision; this procedure works with both direct pushes and merges.
