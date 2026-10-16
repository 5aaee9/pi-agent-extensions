# Design

## Context

See `proposal.md` for the motivation. The facts that shape the approach:

- The workspace is npm (`package-lock.json`, `npm ci`, `npm --workspace`), with six publishable packages in root-level `pi-*/` directories listed in `workspaces`. Each package owns its `tsconfig.json`, `vitest.config.ts`, and dev dependencies, pins the `@earendil-works/*` host packages it builds against, and declares them `"*"` in `peerDependencies`. Pi loads the TypeScript sources directly; there is no build step and nothing generated is committed (`docs/architecture.md`, "How Pi loads a package").
- The release engine lives in `scripts/release/` and runs through Node's type stripping. `scripts/release/plan.ts` finds the versions absent from the registry, and for each upload `scripts/release/build.ts` creates a `git worktree` at that version's commit, runs `npm ci` and `npm pack --workspace <name>` there, inspects the tarball against the manifest's `files` and, when the manifest declares a `pi` manifest, its `extensions`/`skills`/`prompts`/`themes` paths, installs it with `npm install --omit=peer --no-package-lock <tgz>` into an empty directory, and loads the installed copy in that snapshot's `pi` (`-ne -e <installed> --mode rpc`, answering `get_commands` with `PI_OFFLINE=1` and an empty `PI_CODING_AGENT_DIR`). A failure at any of those steps blocks the whole batch (`docs/releases.md`, "What CI does").
- `scripts/release/json.ts` parses every manifest the engine reads (`parseManifest`), and `scripts/release/workspace.ts` makes every non-private workspace package a candidate. The release-impact gate (`scripts/release/gate.ts`) treats `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, and every path inside a `files` entry as a package's published content, so any committed build output inside a `files` entry is published content that needs a release decision.
- `@indexyz/dsh-autocompact` is a working dsh plugin in the sibling repository `dsh-agent-extensions` (`/home/coder/dsh-agent-extensions/dsh-autocompact`). Its manifest is a `dsh` manifest and not a `pi` manifest: `dsh.bundle.patch` points at `cordis.patch.yml` (a bundle patch layer that inserts the row `autocompact` with `config.modelLimits: {}`), and `dsh.client` declares the web platform with its injected `@deepseek-ai/dsh-client-*` services. Its host half compiles with `tsc -p tsconfig.build.json` into `lib/` (declarations, declaration maps, and source maps included, `rewriteRelativeImportExtensions` on); its client half is authored under `src/client/` and built by `tsdown` into a root `client.js`, a single `window.__ModuleLoader__.load({ id: "@indexyz/dsh-autocompact", factory })` registration whose body is CommonJS with `react` and `react/jsx-runtime` left external because the page's module table provides them. Its `files` allowlist ships `lib`, `src`, `client.js`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, and `LICENSE` — the built artifacts have to be committed, because the working dsh profile installs it as `"@indexyz/dsh-autocompact": "link:/home/coder/dsh-agent-extensions/dsh-autocompact"` and the Harness loads those files as they are on disk.
- The dsh toolchain is not Pi: a profile is a pnpm project under `$DSH_HOME/profiles/<name>` (`dsh plugin --profile <name> <pnpm args>` delegates to pnpm there), `dsh web` boots the web profile, the host packages are the `@deepseek-ai/*` packages pinned at `0.2.0-rc.2` today, and the client artifact is fetched by the Harness's own module loader, not by Pi. Pi cannot load such a package, so no `pi -e` command can stand in for its verification.

## Goals / Non-Goals

**Goals:**

- Let a root-level `dsh-<topic>/` package live here, be built, tested, and published by the same release engine, with no npm-side reconfiguration and no Pi-side changes.
- Keep every non-private workspace package under a real verification of the exact installed tarball that will be uploaded, without teaching the engine what a Harness plugin is.
- Keep the release model and every published record of the six Pi packages byte-for-byte unchanged.
- Describe both classes truthfully in `AGENTS.md` and `docs/` so an agent can add the next one.

**Non-Goals:**

- Making Pi load dsh packages, making the Harness load Pi packages, or a shared manifest. The two hosts have different manifest keys, different load contracts, and different build needs.
- A general "arbitrary verification command" hook: the engine takes one declared check per package, and it is a TypeScript script, not a shell string.
- Hoisting dsh dependencies to the root, replacing `tsdown`, or removing `tsc` for the host half. Each is orthogonal and would churn the package for no release benefit.
- Publishing anything during this change, or changing how versions are selected, planned, uploaded, tagged, or recorded.

## Decisions

### 1. A second package class in this workspace, not a second repository

**Choice:** keep one repository, one lockfile, one release engine, and add `dsh-<topic>/` as a peer of `pi-<topic>/`. A dsh package is identified by its `dsh` manifest and the `@indexyz/dsh-<topic>` name, never by a hard-coded name in the engine.

**Why:** the owner maintains both; two repositories already meant two lockfiles, two CI setups, and two copies of a release model (`scripts/check-workspace-versions.mjs` and `pack:autocompact` in the sibling). npm workspaces accept any directory, the engine already treats "every non-private workspace package" as a candidate, and the gate's published-content rules work on any directory. The only genuinely new facts are the manifest key and the verification step.

**Alternatives rejected:**

- _Keep the package in `dsh-agent-extensions` and publish from there._ Keeps two release runbooks and two lockfiles, and the repository that has the trusted publishers, the gate, and the intents would not contain the package.
- _Give dsh packages a `pi` manifest pointing at built files._ Pi would load the wrong half in the wrong host and the Harness would ignore it; the `pi` manifest also promises TypeScript sources, which a dsh package does not have.
- _Move every package under `packages/`._ A repository-wide re-layout for one new class; explicitly a separate change (`adopt-independent-package-releases`, Non-Goals).

### 2. The verification step is declared by the package, not selected by the engine

**Choice:** the manifest gains an optional `release.smoke`, a path relative to the package directory ending in `.ts`. `parseManifest` reads it and rejects any other value; `plan-core.ts`'s `smokeCheck` resolves the package's check as follows:

1. `release.smoke` present → run the declared script;
2. otherwise, `pi` resources present (an `extensions`, `skills`, `prompts`, or `themes` array) → the existing Pi load;
3. otherwise → fail the plan: nothing can verify the installed tarball.

A declared script wins over Pi resources, so a package controls its own check without a new engine special case.

**How the declared check runs.** Unchanged up to the load: the worktree at the version commit, `npm ci`, `npm pack --workspace <name>`, tarball inspection against `files` and any `pi` resources, `npm install --omit=peer --no-package-lock <tgz>` into an empty directory (plus `--legacy-peer-deps` for a package with a `dsh` manifest: npm resolves its `"*"` host peers against the registry while installing and fails on a conflicting prerelease, and the flag still installs the tarball alone), and the SHA-256 recorded in `release-plan.json`. Then, instead of the Pi load, `node <worktree>/<package>/<release.smoke> <installed-package-dir>` (the engine runs it with `process.execPath` from the worktree root), where `<worktree>` is the worktree at the version commit, `<package>` is the package directory, and `<installed-package-dir>` is the installed copy the Pi load would have received (`<scratch>/node_modules/<name>`). The check passes only on exit status 0, and the script's own output is the failure detail when it does not (its stderr, or its stdout when stderr is empty); a declared script that is missing from the version commit fails with its path. The working dsh package's script is `test/smoke-release.ts`: it reads the installed `package.json`, requires every `main` and `exports` target and `lib/index.js` to exist, evaluates the packaged `client.js` against a stub `window.__ModuleLoader__.load` that captures one registration, calls its `factory` with only `react` and `react/jsx-runtime` available, and requires the returned module to export an `inject` string list and an `apply` function — then exits 0 with one line, or non-zero with one line naming the invariant that broke.

**Why the script lives in the package and in `test/`:** it verifies a contract only the package knows (the Harness module-loader shape, the `main`/`exports` promises); it is typechecked by the package's own `tsc --noEmit` because `test/**/*.ts` is in its `include`; and `test/` is excluded from the tarball, so it can never be shipped or mistaken for runtime code. `vitest.config.ts` includes only `test/**/*.test.ts`, so the script is not a test case.

**Why a manifest field rather than a hard-coded package name or directory prefix:** the engine stays host-agnostic, the next dsh package needs no engine change, and the six Pi packages need no change at all — the field is absent, so their code path is the one they already have.

**Validation:** a `release.smoke` that is not a non-empty relative path ending in `.ts` fails manifest parsing; a package that declares neither Pi resources nor `release.smoke` fails `smokeCheck`. Both are unit-tested without a worktree (`scripts/release/test/manifest.test.ts`).

### 3. Publication is otherwise exactly as it was

**Choice:** nothing about version selection, changelog sections, the plan's uploads and record work, tarball inspection, hashing, sequential upload, tags, GitHub Releases, the gate, or the workflows changes. The declared check occupies the load step only.

**Why:** the whole point of the first package class is a release model that never guesses. The upload is still the tarball built and inspected at the version commit; the check is only one more gate on it, and a declared script that exits 0 is as strong a statement about the snapshot as the Pi load was for a Pi package. The gate needs no new rule either: `lib/` and `client.js` are inside the `files` allowlist, so they are published content and a change to them requires a release decision like any other file.

### 4. The root builds what declares a build, and ignores what is generated

**Choice:** the root `package.json` gains `"build": "npm run build --workspaces --if-present"` and `check` becomes `format:check && lint && typecheck && build && test && test:scripts`, so a package that declares a `build` script is built before the workspace tests run. `.oxlintrc.json` and `.oxfmtrc.json` add `dsh-*/lib/**` and `dsh-*/client.js` to `ignorePatterns`.

**Why:** the package's own `check` already runs `typecheck && build && test`, but the root never builds, and a stale committed artifact would otherwise only be noticed by whoever inspects the diff. Building before the tests makes the tests exercise freshly built output. The generated files themselves must not be linted or reformatted: `lib/` is compiler output and `client.js` is a generated CommonJS bundle whose wrapper and formatting are part of its contract, and it carries a "do not edit" header. `--if-present` keeps the six Pi packages, which define no `build`, unaffected. The artifacts stay tracked — the repository's `.gitignore` ignores `node_modules/`, `*.tgz`, and test output only — because a `link:` install resolves them from the working tree.

### 5. The instruction surface and the runbook describe two classes

**Choice:** `AGENTS.md` states the package rules for both directory prefixes (`pi-<topic>/` and `dsh-<topic>/`), the dependency rule for both hosts (`@earendil-works/*` and `@deepseek-ai/*`: exact pins in `devDependencies`, `"*"` in `peerDependencies`), and the build rule (a package that declares one is built by `npm run check`). `docs/architecture.md` adds the second row to its layout, its package anatomy, and its manifest section, and says how each class is loaded. `docs/workflow.md` adds the procedure for creating a `dsh-<topic>/` package and the dsh verification path (`npm run check`, the release plan's dry run against the installed tarball, and a `link:` install into a profile). `docs/releases.md` states seven packages, checks seven trusted publishers in its activation table, and points at its existing "First release of a new package" bootstrap. The root `README.md` gains the package row, and `openspec/config.yaml` counts seven packages in two classes.

**Why:** these documents are the contract agents work from; a rule that says "each package declares a `pi` manifest" is false the moment this change lands, and an agent adding the next dsh package has to be able to find the build, `files`, and verification rules without reading the engine.

**What stays deliberately unchanged in the runbook:** the roles table, intents, the gate table, local preparation, the no-op and failure tables, report, retry, and the abandonment rule. A dsh package version is published, tagged, and announced from its version commit exactly like a Pi one; only its verification line differs, so the runbook names both.

## Risks / Trade-offs

- **A declared script is only as good as what it checks** → the engine still inspects the tarball against `files`, hashes it, and installs it exactly as it does for a Pi package; the declared script is the last step, not the only one. The repository's own example (`test/smoke-release.ts`) checks the packaged artifacts, not the source tree, and a package that declares no way to verify itself cannot ship at all.
- **Committed build output can go stale** → the root `check` builds every package that declares a build before running the workspace tests, the package's own `check` (and therefore `prepack`) builds before testing, and the release plan verifies the artifact from the version commit, so a tarball that does not contain a working `client.js` or `lib/index.js` fails before upload. An artifact that is rebuilt but not committed shows up as published content in the gate and the pull-request diff.
- **A generated bundle next to sources invites hand edits** → the output carries a generated-file header, the root linter and formatter skip it, and the smoke script evaluates it exactly as the page does, so an edit that breaks the registration fails the release check.
- **Two package classes make the instructions longer** → the alternative is instructions that are false for one of them; the docs name the class prefix in every rule that differs and share the rest.
- **The gate counts build output as published content** → intended: `lib/`, `src/`, and `client.js` are in `files`, so a rebuild or a source change under `src/` needs a release decision. Tests and `openspec/` are still excluded by being outside `files`.
- **`npm run build --workspaces --if-present` silently skips a package that forgot its build script** → the package's `check` and `prepack` still fail without a build, and the release plan's declared smoke check fails on a tarball with no built entry.
- **The first upload still needs the owner** → unchanged from every new package: `docs/releases.md`, "First release of a new package", is the procedure, and agents never perform it.

## Migration Plan

1. Add `dsh-autocompact/` to the root `workspaces` array, `npm install` so the workspace links it and `package-lock.json` records it, and confirm the root `pi.extensions` manifest still lists only the six `pi-*.ts` entries.
2. Land the engine change (manifest field, `smokeCheck`, the declared check in the build path, and its tests), the root build step, the ignore patterns, and the documentation in the same pull request as the new package and its `none` intent. No version changes, no positive intent, no publication.
3. Verify locally: `npm run check`, `node scripts/release/gate.ts --base origin/main --head HEAD`, `node scripts/release/plan.ts --dry-run` (expect one upload — `@indexyz/dsh-autocompact@0.1.0` — verified through `node dsh-autocompact/test/smoke-release.ts <installed>`), a `link:` install into a scratch or working profile, and the exercise of `/autocompact`, the Settings section, and the status pill in `dsh web`.
4. After merging, the owner runs the existing bootstrap: the plan verifies the tarball and the publish job fails at the upload, the owner downloads `release-batch`, publishes the exact tarball once, adds the trusted publisher for `@indexyz/dsh-autocompact`, and reruns the failed jobs, which record the tag and Release. Every later version publishes like the six Pi packages.
5. Rollback: revert the change commit. The six Pi packages are untouched by it; a reverted `dsh-autocompact/` leaves its first version unpublished and no record behind.

## Open Questions

- Whether the next dsh package should share a small `release.smoke` helper with this one. Two copies of a loader-contract check would be the signal to add one; one is not.
