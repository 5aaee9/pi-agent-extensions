# Spec Delta

## Purpose

Verify every package version this workspace publishes before it is uploaded, for both package classes: keep the in-Pi load for the Pi extension packages, and accept a check the package declares when Pi cannot load it, without changing how versions are selected, planned, uploaded, tagged, or recorded.

## ADDED Requirements

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

- **WHEN** `@indexyz/dsh-autocompact@0.1.0` is absent from the registry and its declared script exits 0 against the installed copy
- **THEN** the plan records the tarball's SHA-256 and lists it as an upload

#### Scenario: The packaged client artifact is broken

- **WHEN** the installed copy's `client.js` does not register itself through `window.__ModuleLoader__.load`, registers a foreign id, or its factory returns a module without `inject` and `apply`
- **THEN** the declared script exits non-zero with a line naming the broken invariant
- **AND** the plan fails and nothing in the batch is uploaded

#### Scenario: The declared script is not runnable

- **WHEN** `node <worktree>/<package>/<release.smoke>` cannot be started, or exits non-zero for any other reason
- **THEN** the plan fails with the script's output as the detail and no package is uploaded

#### Scenario: The declared script is missing from the version commit

- **WHEN** a manifest declares `release.smoke` but the script does not exist in the worktree at that version's commit
- **THEN** the plan fails naming the declared path and no package is uploaded

### Requirement: The Pi load and every other publication step stay as they are

When a package declares no `release.smoke`, the plan SHALL load its installed tarball exactly as before: `<pi> -ne -e <installed-package-dir> --mode rpc`, answering `get_commands` with `PI_OFFLINE=1` and an empty `PI_CODING_AGENT_DIR`, using the package's own pinned `pi` when present and the worktree's root one otherwise. Whichever check a package uses, version selection, the requirement of exactly one non-empty `## <version>` changelog section at the version commit, tarball inspection against `files` and any `pi` resources, SHA-256 recording, sequential upload with `npm publish <tgz> --access public`, tag and GitHub Release creation, the pull-request release-impact gate, and the workflows SHALL behave exactly as `docs/releases.md` documents them.

#### Scenario: The six Pi packages are untouched

- **WHEN** the engine supports `release.smoke` and no `pi-*` manifest declares it
- **THEN** every `pi-*` upload is verified by the in-Pi load as before
- **AND** their versions, intents, tags, and Releases are unchanged

#### Scenario: A declared check does not bypass tarball inspection

- **WHEN** a package declares `release.smoke` and its tarball is missing a `files` entry or contains a `test/` path
- **THEN** tarball inspection fails before the declared script runs

#### Scenario: Records are created for a declared-check package

- **WHEN** a dsh package's upload passes its declared check and reaches the registry
- **THEN** its tag `@indexyz/<name>@<version>` and its GitHub Release are created from its version commit exactly as for a Pi package
