# Pi packages

What is specific to a `pi-<topic>/` package. Shared process is in `docs/workflow.md`, code rules are in `docs/conventions.md`. To create a package, use `docs/pi/new-package.md`; for Pi's API, use `docs/pi/reference.md`.

## Anatomy

```
pi-<topic>/
├── package.json        @indexyz/pi-<topic>, version, files allowlist, pi manifest, scripts, peer and dev dependencies
├── README.md           what it does, how to install, commands and configuration it provides
├── CHANGELOG.md        release notes; new sections are written by `changeset version` and reviewed
├── LICENSE             MIT, shipped in the tarball
├── index.ts            extension entry: default export function (pi: ExtensionAPI)
├── *.ts                implementation modules next to index.ts, kept free of Pi API where possible
├── data/               optional bundled data (pi-model-trace ships data/unified_bank.json)
├── test/
│   └── *.test.ts       Vitest tests
├── tsconfig.json       the package's strict compiler settings (noEmit; typecheck only)
├── vitest.config.ts    the package's test configuration
└── openspec/           the package's own OpenSpec root: specs/ and changes/
```

- Pi reads `package.json`, resolves the `pi` manifest, and imports each extension entry from TypeScript source, so a Pi package has no build and no `dist/`. The default export runs once per extension runtime; a `/reload` replaces the runtime. Loading happens in-process, so an extension has the same permissions as Pi itself.
- `index.ts` is the entry Pi loads (`pi.extensions: ["./index.ts"]`). It wires registrations (`pi.registerCommand`, `pi.registerProvider`, `pi.on`, ...) to implementation modules.
- `files` lists every shipped file explicitly (each `.ts` module, `README.md`, `CHANGELOG.md`, `LICENSE`, data files). A new module that is not added to `files` is missing from the published package; the publication plan rejects a tarball that lacks a declared file. `test/`, `tsconfig.json`, `vitest.config.ts`, and `openspec/` are never in `files`.
- Scripts are `test` (`vitest run`), `test:watch`, `typecheck` (`tsc --noEmit`), `check` (typecheck and tests), and `prepack` (`npm run check`, so packing always runs the package's checks).

## Hosts

The host packages are `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui`; `docs/conventions.md`, "Dependencies", says how to declare them. Each package pins its own Pi version and keeps its `@earendil-works/*` dev dependencies on one version. Raise a pin when the package needs a newer host API, and say in its README which Pi version it requires.

To upgrade one package: bump all of its `@earendil-works/*` dev dependencies together to the new exact version, run `npm install`, read that version's `CHANGELOG.md` for breaking changes (`docs/pi/reference.md` says which copy), update the README if the package now requires a newer Pi, and verify ("Verify" below). The upgrade changes `package.json`, a published file, so it needs a release decision.

The `Rehearse the next Pi release` workflow does this against the newest Pi every day, in CI's throwaway checkout: it moves the Pi packages' pins, installs, and runs their typecheck, package tests, the load check, and `test:e2e:pi`, leaving dsh packages alone. A red run means a published Pi breaks something, before any pin moved; read the failing step and the Pi version in the summary, and start the upgrade above. To rehearse a specific version, run `gh workflow run pi-host-rehearsal.yml -f pi-version=<version>`, or `node scripts/e2e/pi/rehearse.ts --throwaway --version <version>` in a scratch checkout, because it rewrites manifests and the lockfile.

## Extension design

These follow from Pi's extension contract; `docs/pi/reference.md` says where it is documented.

- The default export registers capabilities (commands, providers, event handlers) and returns. Pi may load extensions without starting a session, so do not start processes, timers, sockets, or watchers from it. Start session-scoped work in `session_start` or in the command or event handler that needs it, and release it in an idempotent `session_shutdown` handler.
- Treat `ctx` as valid only for the duration of the handler that received it.
- Extensions must keep working in print, JSON, and RPC modes; guard interactive UI behind the checks Pi documents.
- User-facing feedback goes through `ctx.ui` (notifications, status, footer). Diagnostic logging that is not meant for the conversation uses `console.warn` / `console.error` with a `[<topic>]` or `[<topic>:<provider>]` prefix, as the provider packages do. Never log secrets such as API keys or command output used as credentials.
- Fail loudly with a message that says what was expected; never swallow an error silently.

## Tests

These add to `docs/conventions.md`, "Tests".

- A `pi-<topic>/` package has three kinds of test. Its own logic (parsers, reducers, config migration) is tested directly on plain data or with real pinned host utilities such as `SessionManager`, simulating no host behaviour: a fake model registry or a hand-built `pi.on` can disagree with the real host while the test passes. Behaviour that depends on Pi is tested through Pi: in the package's `test/` when a real host plane fits, or as a scenario in `scripts/e2e/pi/`, which installs the packed tarball and drives the published bin ("Verify" below). Logic vendored from the host because Pi does not expose it is compared with the pinned host's implementation on the same fixtures. The existing tests of `pi-ask`'s Pi 1.4.0 status fallback stay as they are until that fallback is removed; no new test takes that exception.

## Verify

Run the commands in `docs/workflow.md`, "Verify", then the scenarios in `scripts/e2e/pi/`. They need nothing beyond `npm install`:

```bash
node --test "scripts/e2e/pi/<name>*.e2e.ts"
npm run test:e2e:pi
```

The first runs one package's scenarios while you iterate, and the second is the whole Pi suite, which also covers what must hold across co-installed packages. Each scenario installs the packed tarball and drives the published `pi` bin over RPC, print, JSON, or a real terminal against local protocol servers, with no credential. A scenario must name the failure it guards and be seen detecting it once (`openspec/specs/pi-package-e2e/spec.md`). The suite never touches `dsh-*` packages.

For behavior that needs a live session (providers, UI, events), run `pi -e ./<name>/index.ts` from the repository root and exercise the feature. A running Pi session keeps the extension code it loaded at startup, so restart Pi or `/reload` after editing.

If the strict settings reject something, find the type in the installed Pi declarations and an example that uses the same API, and match its shape. If Pi's types genuinely prevent the design, change the design and say so in the final report.

## Release

A Pi package is loaded in Pi by the publication plan from its installed tarball. Everything else follows `docs/releases.md`. Its install command is `pi install npm:@indexyz/<name>`.
