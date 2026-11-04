# Workflow

The process both plugin systems share. Each step that differs by system links `docs/pi/README.md` or `docs/dsh/README.md`.

## Choose the scope

Every command below runs from the repository root. The scope follows what you changed, so a change to one system never runs, builds, or depends on the other.

| You changed                                                                                                                   | Scope                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| One package                                                                                                                   | That package                                                                                                          |
| Several packages of one system, such as a host upgrade                                                                        | Those packages, or the whole-system forms in "Verify"                                                                 |
| Pi-only root tooling: `scripts/e2e/pi/`, `.github/workflows/pi-host-rehearsal.yml`, the root `node-pty` dependency            | Pi: `npx oxfmt --check scripts/e2e/pi`, `npx tsc -p tsconfig.json`, `npm run lint:tooling`, and `npm run test:e2e:pi` |
| Other shared root tooling: the rest of `scripts/`, root configuration, `lint.yml`, `publish.yml`, `.changeset/` configuration | Repository-wide: root `npm run check`, `npm run test:e2e`, and `npm run test:e2e:pi`                                  |
| Documents only                                                                                                                | `npx oxfmt --check` on the changed files                                                                              |

Crossing systems for any other reason needs an explicit request. A failure in the other system during a scoped run or in CI is reported, not fixed as part of the change.

## Plan with OpenSpec

Non-trivial work (a new package, a new command or provider feature, a behavior change, a removal) is planned with OpenSpec before code is written. Trivial fixes (typos, a one-line bug with an obvious test) can skip it.

Two roots exist, and the CLI picks the nearest one above the working directory:

| Work                                                    | Working directory                   | Root               |
| ------------------------------------------------------- | ----------------------------------- | ------------------ |
| One package                                             | `<name>/` (for example `pi-skill/`) | `<name>/openspec/` |
| Repository-wide (tooling, workflows, docs, conventions) | repository root                     | `openspec/`        |

OpenSpec is pinned in the root development dependencies. Invoke it as `npx openspec` from the directory in the table, because from the repository root a package change would land in the wrong root. Check with `npx openspec context --json` when unsure: `root.path` must be the package directory for package work.

The workflow is the standard one, available as skills in `.agents/skills/` (`openspec-propose`, `openspec-apply-change`, `openspec-archive-change`, ...):

1. Propose: creates `openspec/changes/<change>/` with `proposal.md`, spec deltas, `design.md`, `tasks.md`. Stop and let the user review.
2. Apply: implement the tasks, checking them off as they are verified.
3. Archive: merges spec deltas into `openspec/specs/` and moves the change to `changes/archive/`.

A package's `openspec/specs/` is the current description of what that package does; keep it truthful when archiving.

## Change a package

1. Read the package README, `openspec/specs/`, and `index.ts` first, then the modules you touch.
2. For non-trivial changes, propose from `<name>/` and wait for review.
3. Make the change with its test. Keep the package's public surface (command names, provider names, settings files) stable unless the change is the point. Add new modules to `files` (and to `tsconfig.json` `include` if it lists files explicitly).
4. Update the README when commands, flags, or configuration change.
5. Record the release decision (`docs/releases.md`): `npm run change -- --<patch|minor|major> @indexyz/<name> -m "<summary>"`, or a `none` intent with a reason. One intent file per package.
6. Verify, archive the change, then commit as `fix(<topic>): ...` or `feat(<topic>): ...`.

## Verify

A package's verification runs through its host, following `docs/conventions.md`, "Tests"; the tests of a Pi package's own logic that need no running host are defined in `docs/pi/README.md`, "Tests". Two boundaries apply today:

- Where a path needs a credential the environment cannot hold, the test names the credential route it needs and fails; it does not stub the response and does not skip silently. Model-call conversions are recorded as pending until a credential route is granted.
- Live endpoints stay untested for the provider packages. `pi-provider-sub2api` is exercised against a local relay in `scripts/e2e/pi/`, and nothing fakes a live reply into passing.

For each package in scope, format with `npx oxfmt <name> .changeset`, then run these from the repository root:

```bash
npx oxfmt --check <name> .changeset
npx oxlint --deny-warnings <name>
npm run check --workspace @indexyz/<name>
npm run test:e2e -- --package @indexyz/<name>
```

`check` runs the package's typecheck and tests, plus the build for a dsh package. `test:e2e --package` then loads it through its own host from its packed tarball, offline and with isolated directories. A Pi package is installed with `pi install` into an isolated agent directory, so no host package sits beside it as for a user, and answers `get_commands` over RPC with `PI_OFFLINE=1`; a package that imports a file its `files` allowlist does not ship, or a host path Pi does not map, fails here. An installed Pi that differs from the package's exact pin is rejected with an `npm install` hint. A dsh package is built, packed, installed into a temporary directory without peer resolution, and checked with its `release.smoke` script. The run makes no model or business API calls, applies a 120-second per-package timeout (`--timeout-ms <milliseconds>` adjusts it), and prints the command, exit status, stdout, and stderr on failure.

Then finish with your system's document, which adds what only that host needs: `docs/pi/README.md` or `docs/dsh/README.md`, "Verify". State in the final report exactly what was exercised.

To cover every package of one system, use its kind and a loop rather than a root command:

```bash
npm run test:e2e -- --kind pi
npm run check $(for d in pi-*/; do printf -- '--workspace @indexyz/%s ' "${d%/}"; done)
```

Once the change is committed on a branch, run the release-impact gate as CI does: `npm run release:gate -- --base origin/main --head HEAD`. It reads the branch's diff and fails when a package's published content changed without a release decision (`docs/releases.md`).

A repository-wide change runs the same gate after root `npm run check` (format, lint, typecheck, every build, every package's tests, and the release-script tests), `npm run test:e2e`, which discovers every plugin from the workspace manifests, continues after an individual failure, and exits non-zero after printing the full summary, and `npm run test:e2e:pi`.

## Remove a package

Delete `<name>/` (its OpenSpec root goes with it), remove it from the root `package.json` `workspaces`, and for a Pi package from `pi.extensions` and `scripts/e2e/pi/registrations.ts` along with its `scripts/e2e/pi/<name>*` files, remove its row from the root README, delete any pending intent naming it from `.changeset/`, run `npm install` to update the lockfile, and commit as `chore(repo): remove <name>`. Versions already on npm stay there; never unpublish them.
