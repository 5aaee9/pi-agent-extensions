# Conventions

Rules for code in every package, whichever system it belongs to. Rules that only one host forces are in `docs/pi/README.md` and `docs/dsh/README.md`.

## Package boundaries

- One directory, one package: `<name>/` works on its own, with its own manifest, `files` allowlist, scripts, dev dependencies, `tsconfig.json`, and `vitest.config.ts`.
- Its npm name is always `@indexyz/<name>`. The directory and the package OpenSpec root use `<name>`; release intents, `npm --workspace`, the registry, and tags use `@indexyz/<name>`. Runtime identifiers (commands, settings files such as `sub2api.json`, session entry types, custom message types) never derive from or change with the npm name.
- The root contains no plugin runtime code. Change root files only for repository-wide concerns, never to work around one package's problem.

## Language and formatting

- TypeScript only, as ES modules (`"type": "module"`), Node `>=22.19.0` (`engines.node`). Every source, test, and tooling file is `.ts`; never add `.js`, `.mjs`, or `.cjs` source files. A dsh package's generated `client.js` and `lib/` are build output, never edited by hand.
- Tooling runs through Node's built-in type stripping (`node scripts/release/<name>.ts`), so it uses only erasable syntax: no `enum`, `namespace`, or parameter properties.
- oxfmt formats everything with its default style; never hand-format against it. oxlint runs with `--deny-warnings`, and `scripts/` and `.changeset/` get the stricter type-aware profile in `.oxlintrc.tooling.json`.
- Relative imports carry the `.ts` extension (`./config.ts`). Node built-ins use the `node:` prefix. Use `import type` / `export type` for type-only imports (`verbatimModuleSyntax` is on).
- Files are kebab-case. Types and classes are PascalCase, everything else camelCase. Commands are kebab-case (what the user types, for example `/toggle-fast`).
- New code meets the strictest configuration that applies to it. Fix the code, not the rule: no `@ts-ignore`, `@ts-expect-error`, or lint suppressions, and no loosening of a package's `tsconfig.json` or the shared configs.
- A package's `tsconfig.json` `include` either globs its modules or lists them; when it lists them, add new modules there too.

## Dependencies

- Host packages go in `peerDependencies` with range `"*"` and an exact pin in the package's `devDependencies` for types and tests; never `dependencies`, never bundled, because the host supplies them at runtime and a bundled copy breaks its module mapping. List only the ones the package imports. `docs/pi/README.md` and `docs/dsh/README.md` name each system's hosts.
- Prefer Node built-ins and the host packages before adding a dependency. Add a runtime dependency only when it removes real complexity, add it to the package (never the root), and run `npm install` so `package-lock.json` updates. Installed packages load from their own directory, so a package may not rely on another package's dependencies.
- Per-package dev tooling (`typescript`, `vitest`, `@types/node`) lives in each package's `devDependencies`; the root `devDependencies` hold only repository tooling, including `node-pty` for the Pi E2E suite's real terminals.

## Tests

- Vitest, files under `<name>/test/*.test.ts`, configured by the package's `vitest.config.ts`. `npm run test --workspace @indexyz/<name>` runs one package.
- A test asserts behaviour a caller relies on and that could plausibly break. It does not restate a constant, a default, or a display string with no user-visible failure mode; assert a manifest, configuration, documentation, or test helper; assert the host's behaviour instead of the package's; repeat a failure mode another test already covers; or pass with its subject broken. A test that guards a real past bug is removed only after a test covering the same failure mode has been seen detecting it. One that guards a user-visible behaviour is removed only when another test in the package asserts the same path, or a scenario with a recorded observation covers that failure.
- A Pi package may also test its own logic without a running host (`docs/pi/README.md`, "Tests"). A dsh package test has no such exception.
- Test implementation modules directly through their running host plane where a test drives a host. A `pi-<topic>/` package test that does so drives the package through Pi's real extension loader (the pinned `@earendil-works/pi-coding-agent`, an isolated `PI_CODING_AGENT_DIR`) and its real settings/filesystem surface; a `dsh-<topic>/` package test mounts the pinned dsh runtime and the real services its plugin injects. Replace nothing: no `vi.mock` of a host package, no hand-rolled fake settings/engine/LLM stream, no stub React or `__ModuleLoader__` harness, no `runInNewContext` browser shim. Where code performs a network call, exercise it with the real HTTP client against a real server (a locally started one when credentials are not needed). Where code streams or resolves models, drive the real LLM stack with the model the package's own settings surface selects — never an injected stream. Stream-shape behaviour (delta assembly, finish kinds, deadlines, aborts) needs no credential: point a real adapter route (for dsh, an `llm-pi-ai` provider profile; for Pi, a `models.json` provider) at a locally started server that speaks the provider protocol; only a reply from a live endpoint is credential-gated.
- Keep `index.ts` thin for clarity and composition, not so that logic can run without its host.
- A real plane must be reproducible and clean: every host package or plugin a test installs is pinned exactly in the package's `devDependencies` (so it is in `package-lock.json`) or replaced by a locally started route — never installed by registry name at test time. Helpers kill every process they spawn (process group, including on startup timeout and process exit), remove every temporary directory, write nothing outside temporary directories they own, and fail with a "run the build" message when built artifacts are missing or older than the sources. Adding a test-only `devDependencies` entry needs a `none` release intent because `package.json` ships in the tarball.
- If a path needs a credential the environment cannot hold (a live model endpoint), the test names the credential route it needs and fails; it never stubs the response and never skips silently. Live endpoints stay untested for the provider packages; their behaviour is exercised against local relays, and no test stands in for a live reply.
- Every bug fix adds a test that failed before the fix.
- The root release tooling is tested with Node's built-in runner on its `.ts` test files (`npm run test:scripts`), not Vitest. Test helpers live next to the tests (`scripts/release/test/`).

## Documentation

- Each package has a `README.md` with its purpose, an install section (the system's install command and the tag format `@indexyz/<name>@<version>`), every command and setting it registers, and its configuration locations. Never state that a version is released before it is.
- Each package's `CHANGELOG.md` keeps its history. New sections are generated by `changeset version` from release intent summaries and reviewed by hand; their prose is the release notes. Write summaries for users, not from commit messages.
- The root `README.md` package table lists every package with its description. Keep it and each package's `README.md` in sync with the code.
- Comments explain why, not what. No commented-out code, no change logs in comments.

## Commits

Conventional Commits. The scope is the package directory without its prefix: `feat(skill): ...` for `pi-skill`, `fix(autocompact): ...` for `dsh-autocompact`, spelled out when two packages would share the scope. Release preparations use `release`, and repository-wide changes use `repo`. Scopes carry no versioning meaning.
