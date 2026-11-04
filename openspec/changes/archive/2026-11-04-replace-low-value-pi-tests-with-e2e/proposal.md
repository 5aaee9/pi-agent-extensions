# Proposal

## Why

Every Pi package test passes while real user-facing failures ship: an audit of all 720 Pi test cases, and the work it led to, confirmed eleven live defects that a green `npm run check` cannot see. The suites spend their effort on the wrong things. No test exercises what users actually run (a packed tarball installed by `pi install`, no host packages on disk, the bundled `pi` bin), and most `pi-provider-sub2api` tests assert against a hand-built host.

Pi also moves faster than the pins: 14 releases in the last six weeks, several with breaking changes, while every package declares its host peers as `"*"`. A user's Pi is routinely newer than the version the package was tested against, and nothing in the repository looks at that gap.

The audit does not support deleting tests wholesale. Its verdicts are in `audit/`:

| Verdict                                   | Cases | Share | Disposition                                          |
| ----------------------------------------- | ----- | ----- | ---------------------------------------------------- |
| Meaningless                               | 129   | 18%   | Deleted                                              |
| Worthwhile behaviour on the wrong harness | 186   | 26%   | Rewritten as E2E scenarios, then removed             |
| Real value                                | 405   | 56%   | Kept, some with a corrected entry point or assertion |

## What Changes

- **Delete** 129 test cases that restate the implementation, test manifests, test Pi rather than the package, are vacuous, or only observe a stand-in host.
- **Add a black-box Pi E2E suite** (`npm run test:e2e:pi`) that packs each package, installs the tarball with `pi install`, and drives the published `pi` bin over RPC, print, JSON, and a real PTY against local protocol servers. It needs no credentials.
- **Admit a scenario only with evidence.** Each one names a concrete failure mode (an upstream issue, a past regression here, a confirmed defect, or a contract whose breakage would be silent) and is shown once to detect that failure by a deliberate regression. Research ruled out candidates that do not qualify; see `design.md`.
- **Rewrite 186 stand-in cases** as 37 catalog scenarios, 159 test cases in all, then remove the originals. This includes converting `pi-provider-sub2api` to a local relay, which ends the earlier deferral of that package's conversion by explicit owner decision. Live endpoints stay untested and no credential is added.
- **Change the load check** in `npm run test:e2e` for Pi packages from a checkout, where host packages resolve from the workspace, to the installed tarball. **BREAKING for the check, not for users:** a package missing a file from `files` now fails it.
- **Add a scheduled upgrade rehearsal** that moves the Pi pins to `latest` in a throwaway CI checkout and runs typecheck, package tests, and the E2E suite, so a breaking Pi release is found before users report it.
- **Fix the eleven confirmed defects**, each in a package-scoped OpenSpec change with a `patch` intent (one per affected package for the offline defect, so twelve changes), and each landing with the scenario that failed before the fix:
  - `pi-continue`: `/continue` makes no model request in print and JSON modes.
  - `pi-skill`: `$skill` tells the model the wrong reference directory, and a queued `$skill` takes a model turn of its own.
  - `pi-autocompact`: boundary summaries drop reasoning effort and the output limit, and a failed turn sends a paid summary.
  - `pi-custom-provider`: cross-model thinking leaks into Ollama's visible history.
  - `pi-custom-provider` and `pi-provider-sub2api`: network requests at startup ignore `--offline`.
  - `pi-ask`: `/answer` fails on the default configuration without Anthropic credentials, and a digit answer does not auto-submit.
  - `pi-provider-sub2api`: `stream_read_error` is not retried despite the documented promise (normalized so Pi retries it), and `/reload` keeps sending a rotated-out token after an API switch or provider removal.
- **Amend the testing policy** so pure package logic may be tested without a host, while a hand-built host stays forbidden. Today's wording condemns the kept parser, state machine, and config migration tests, which run no Pi process and are the right tool for that logic.

DSH is a no-op: no `dsh-*/` file, no DSH requirement, and no part of the DSH load path changes.

## Capabilities

### New Capabilities

- `pi-package-e2e`: how Pi packages are proven from the outside, as installed artifacts driven through the published bin; what earns a scenario; and how a future Pi release is rehearsed.

### Modified Capabilities

- `plugin-e2e-loading`: Pi packages load from their installed tarball rather than the checkout. The DSH requirements are unchanged.
- `real-environment-testing`: Pi package tests may exercise pure logic without a host, and must assert behaviour that can break. The DSH requirements are unchanged.

## Impact

**Why repository-wide.** The testing policy, the shared `scripts/e2e/` harness, CI workflows, and root docs span all eight Pi packages, and co-installed behaviour cannot live in any one of them. Runtime fixes stay in their own package roots, following the `verify-pi-150-host` precedent.

**Packages and release decisions.**

| Package                                                                                                     | Scope                                        | Release decision                                    |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `@indexyz/pi-continue`, `pi-skill`, `pi-autocompact`, `pi-ask`, `pi-provider-sub2api`, `pi-custom-provider` | Test cleanup plus defect fixes               | `patch`, recorded in each package-scoped fix change |
| `@indexyz/pi-idle-compression`                                                                              | Test cleanup only; nothing published changes | None required                                       |
| `@indexyz/pi-model-trace`                                                                                   | Test cleanup and a README correction         | `none`, recorded                                    |
| Any package whose `package.json` or `README.md` changes without a fix                                       |                                              | `none` with the reason, one intent file per package |

Test-only changes need no decision (`docs/releases.md`). No versions are prepared or published.

**Other surfaces.** `scripts/e2e/`, root `package.json` and lockfile (an exact `node-pty` dev pin), `.github/workflows/`, `docs/conventions.md`, `docs/workflow.md`, `docs/architecture.md`, `AGENTS.md`'s command table.

**Coordination.** The untracked `isolate-plugin-systems-in-agent-docs` change moves these docs and replaces root `npm run check` with scoped commands. Whichever lands second rebases its doc edits; its Pi-only verification principle matches `test:e2e:pi`.
