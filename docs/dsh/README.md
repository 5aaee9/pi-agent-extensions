# dsh packages

What is specific to a `dsh-<topic>/` package: a Cordis plugin for the DeepSeek Harness, unrelated to Pi. Pi's commands, manifest, and documents do not apply to it. Shared process is in `docs/workflow.md`, code rules are in `docs/conventions.md`. To create a package, use `docs/dsh/new-package.md`.

## Anatomy

```
dsh-<topic>/
├── package.json        @indexyz/dsh-<topic>, version, files allowlist, dsh manifest, scripts, peer and dev dependencies
├── index.ts            host half entry, compiled to lib/index.js
├── src/                host implementation modules, plus src/client/ for the browser half
├── client.js           the browser half, bundled by tsdown to this one path
├── lib/                compiled host half, the tarball's main entry and types
├── cordis.patch.yml    the Loader patch the dsh manifest points at
├── README.md           what it does, how to install, commands and configuration it provides
├── CHANGELOG.md        release notes; new sections are written by `changeset version` and reviewed
├── LICENSE             MIT, shipped in the tarball
├── test/
│   └── *.test.ts       Vitest tests
├── tsconfig.json       the package's strict compiler settings
├── tsconfig.build.json the emit configuration for lib/
├── tsdown.config.ts    the browser bundle configuration
├── vitest.config.ts    the package's test configuration
└── openspec/           the package's own OpenSpec root: specs/ and changes/
```

- The Harness reads the `dsh` manifest, mounts the Loader patch it names, and loads the host half from the built `lib/` entry. Its web frontend fetches the declared `client.js` and evaluates it with `window.__ModuleLoader__`, which is why the browser half is one bundled CommonJS file whose only imports are `react` and `react/jsx-runtime`.
- `lib/` and `client.js` are Git-ignored build output, never committed or edited by hand. `prepack` builds them and `files` ships them. A local `link:` install consumes files from disk without building, so run `npm run build --workspace @indexyz/<name>` before adding a checkout to a profile. The root oxfmt and oxlint configs ignore these paths.
- The package declares the `dsh` manifest (its bundle patch) and a `client` half naming the platform and the client services it needs. It declares no `pi` manifest, and the root `pi` manifest never lists it.
- Scripts are `build`, `build:host`, `build:client`, `typecheck`, `test`, `check`, and `prepack`, with the build included in `check` and `prepack`.

## Hosts

The host packages are the `@deepseek-ai/dsh-*` packages and `@deepseek-ai/schemastery` the package builds against; `docs/conventions.md`, "Dependencies", says how to declare them. They are supplied by the installation, not by the package.

Answer API questions from the installation the package pins, not from memory. Each host package under `node_modules/@deepseek-ai/<package>/` ships a `README.md` and its declarations under `lib/types/`. A package pinning a different version than the root gets its own copy under `<name>/node_modules/@deepseek-ai/`; read that one when it exists.

## Verify

The web-plane tests install the package into a throwaway profile with the pinned host's `dsh plugin --profile web add`, which forwards to `pnpm`, and drive the page with Playwright's Chromium. Before the commands in `docs/workflow.md`, "Verify", which every dsh package runs, a machine therefore needs:

- `pnpm` on `PATH`. CI installs `pnpm@11.28.5` globally; it is a host tool, not this repository's package manager.
- The browser, from `npx playwright install chromium`.

Then install the checkout into a dsh profile and confirm the Harness sees its row and its page, using the pinned CLI, and name the profile you used in the report:

```bash
npm run build --workspace @indexyz/<name>
node_modules/.bin/dsh plugin --profile <profile> add ./<name>
```

A Harness picks up a rebuilt `client.js` of an installed package on a page refresh, and needs a restart for its host half.

## Release smoke script

Pi cannot load a dsh package, so its manifest declares its own check, which `npm run test:e2e -- --package` and the publication plan run against the packed and installed tarball:

```json
"release": { "smoke": "test/smoke-release.ts" }
```

The script is a relative `.ts` path, runs from the version commit's worktree under `node` with the installed package directory as its only argument, and must exit 0; its own output is the failure detail shown when it does not. It is the package's replacement for the Pi load and nothing else: the tarball inspection, the isolated install, the version, the upload, the tag and the Release are unchanged. A package that declares neither Pi resources nor `release.smoke` fails its plan, naming both, because nothing would verify what it publishes.

Such a package declares its host packages as `"*"` peers, and npm resolves peers against the registry while installing the tarball, which fails when those prereleases conflict. So a package with a `dsh` manifest is installed with `--omit=peer --legacy-peer-deps` instead of `--omit=peer`: the tarball still lands alone in the empty directory, and the declared check decides whether what landed is usable.

The script checks what the host will actually load, in its real environment: every manifest entry of the installed tarball and, for a package with a browser half, the installed package running on a real `dsh web` server in Chromium (`docs/conventions.md`, "Tests"). A package without a browser half checks its built entry statically, because the isolated install omits the host packages it imports. To run it by hand after building:

```bash
node <name>/test/smoke-release.ts <name>
```

## Release

Everything else follows `docs/releases.md`. Its install command is `dsh plugin --profile <profile> add @indexyz/<name>`.
