# Releases

How packages are versioned and published. Agents decide what ships by writing release intents and preparing versions locally; CI only publishes and records what a commit on `main` already contains.

| Who                                     | Does                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Agent, in feature work                  | Records a release decision for every package whose published content changed                                                             |
| Agent, at release time (on request)     | Prepares versions and changelogs locally, reviews them, verifies them with a dry-run plan, commits the preparation                       |
| Owner (or an agent explicitly asked to) | Pushes the preparation to `main`, directly or by merging its pull request; that push is the publication boundary                         |
| CI (`publish.yml`)                      | Publishes every package version absent from npm, built from the commit that introduced it, then creates missing tags and GitHub Releases |

Read this document for the routine. For a failed gate, a failed publication, or a retry, read `docs/releases/ci.md`. For a package that has never been on npm, read `docs/releases/first-release.md`.

## Release one system at a time

A release covers one plugin system unless the user explicitly asks for both: a Pi release prepares only `pi-*` packages and a dsh release only `dsh-*` packages. Each system's pending intents stay untouched by the other's preparation, so they wait for that system's own release.

## Identity

Every package publishes as `@indexyz/<name>` from the root-level directory `<name>/`, with a prefix naming its system.

| Use                                                                 | Pi example                         | dsh example                                             |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Directory, package OpenSpec root                                    | `pi-skill/`                        | `dsh-autocompact/`                                      |
| `package.json` `name`, release intents, registry, `npm --workspace` | `@indexyz/pi-skill`                | `@indexyz/dsh-autocompact`                              |
| Install from npm                                                    | `pi install npm:@indexyz/pi-skill` | `dsh plugin --profile web add @indexyz/dsh-autocompact` |
| Tags and GitHub Releases                                            | `@indexyz/pi-skill@0.1.44`         | `@indexyz/dsh-autocompact@0.1.0`                        |

Commit scopes are in `docs/conventions.md`, "Commits", and carry no versioning role. Runtime identifiers (commands, settings files, session entry types) never change with any of these. The private workspace root is never versioned or published.

Versions are independent per package. There is no repository version. `v*` tags are history, and pushing one publishes nothing.

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

Published content that reached `main` without a decision (a direct push, or a pull request merged before the gate existed) gets its intent in the next pull request, before that package's next release. Pull requests are checked by the release-impact gate; its rules are in `docs/releases/ci.md`.

## 2. Prepare a release locally

Do this only on an explicit release request. Source changes and their intents must already be on local `main`; the preparation contains only release records and reviewed prose. For a new npm package, follow `docs/releases/first-release.md`: prepare locally, but keep its commits off GitHub until the owner has published the empty bootstrap package and configured Trusted Publisher.

1. Start from an up-to-date `main` with a clean working tree:

   ```bash
   git switch main
   git pull --ff-only
   git status --short
   git switch -c release/<system>-<yyyy-mm-dd>
   ```

2. Inspect what is pending: `npm run change:status`. Use `npx changeset status --verbose` to see which intent files cause each bump. The output covers both systems; act only on your system's packages.
3. Consume the intents of one system by ignoring every package of the other. This is the Pi form; swap the glob to `pi-*/` for a dsh release, and add `--ignore @indexyz/<name>` for any package of your own system you are excluding:

   ```bash
   npm run release:version -- $(for d in dsh-*/; do printf -- '--ignore @indexyz/%s ' "${d%/}"; done)
   ```

   For each selected package with a positive intent this bumps `package.json` to the highest pending bump, inserts a `## <version>` section with `### Major Changes` / `### Minor Changes` / `### Patch Changes` lists above the first existing version heading, and deletes the consumed intents. `none` intents of selected packages are deleted without a version change. Excluded packages' intents stay untouched.

4. Refresh the workspace versions recorded in the lockfile:

   ```bash
   npm install --package-lock-only
   ```

5. Review before committing: every manifest version, every new `CHANGELOG.md` section, the consumed and remaining intent files, and the lockfile diff (only the bumped packages' `version` entries should change). No file of the other system may appear. Edit the section prose freely; keep its `## <version>` heading and never edit versions by hand. A README update that belongs to the release may join the preparation.
6. Verify each prepared package as its system's document says (`docs/pi/README.md` or `docs/dsh/README.md`, "Verify"). The publish workflow runs root `npm run check` on `main` before planning, so a preparation that fails it (for example a generated section that does not pass the format check) blocks every upload, and a direct push to `main` skips `lint.yml`.
7. Commit: `chore(release): prepare @indexyz/pi-skill 0.2.0` (name every prepared package and version).
8. Confirm the other system has no unpublished version. The plan in the next step has no package filter: it builds, tests, and loads every version absent from npm, whichever system it belongs to. This is the Pi form; swap the glob to `pi-*/` for a dsh release:

   ```bash
   for d in dsh-*/; do npm view "@indexyz/${d%/}@$(node -p "require('./${d}package.json').version")" version >/dev/null 2>&1 || echo "unpublished or unreadable: ${d%/}"; done
   ```

   If it names a package, stop and ask before running the plan, because running it would cross systems.

9. Verify the snapshot exactly as CI will:

   ```bash
   node scripts/release/plan.ts --dry-run
   ```

   It plans from `HEAD`: for every version absent from npm it builds the tarball at that version's commit, inspects it, installs it in isolation, and verifies it through its host. It needs network access (npm registry, `git fetch` from `origin`, and `gh` when available) and writes nothing to the registry or GitHub; without GitHub access it reports Release state as unknown. Fix any failure in your own packages by revising the preparation on the branch (below) before handing it over.

10. Hand over: report the planned versions and the dry-run result, and stop. Push the branch, open a pull request, push to `main`, or merge only when the request explicitly asks for that action. A request to prepare a release is not permission to publish.

### Do not stack preparations

Changesets bumps from the current manifest version, so preparing a package again while a prepared version of it is unpublished would skip that version and leave a section no run will ever publish. Therefore:

- To revise an unmerged preparation, rebuild it: reset the release branch to `main` (or revert the preparation commit on it), land any new or revised intents on `main` first, and prepare again.
- After a preparation reaches `main`, finish its publication (`docs/releases/ci.md`, "Retry") before preparing that package again.
- Retrying a publication never runs `npm run release:version`.

The one exception is an **abandoned** version. A version on `main` may be abandoned only when the registry confirms it absent and the workflow has shown it cannot ship as it is: its plan failed (a `files` entry that does not exist, a failing load, a missing or duplicate section), or its upload failed for a reason in the package itself. A version superseded by a second preparation before it was published is abandoned the same way. Leave an abandoned version behind: land the fix with its own intent, and the next preparation bumps past it (`0.2.0` abandoned, `0.2.1` prepared). The dangling `## <abandoned version>` section stays in the changelog as history; do not edit or delete it. An uncertain upload outcome (a timeout, a registry error, anything that may have reached npm) is retried, never abandoned. `main` is never reverted to a published version to undo a preparation.

## 3. Report

After a release push, report from the workflow run, not from local checks: the release commit, each package's version and outcome (published, already published, failed, not attempted), and whether its tag and GitHub Release exist. Local checks, dry runs, and plans are never reported as publications.
