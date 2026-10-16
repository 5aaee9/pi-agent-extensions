# Conventions

Rules for code in the `pi-*/` package directories. Where this document and Pi's own documentation disagree about Pi's API, Pi's documentation wins; fix this document.

## Language and formatting

- TypeScript only, as ES modules (`"type": "module"`), Node `>=22.19.0` (`engines.node`). Every source, test, and tooling file is `.ts`; never add `.js`, `.mjs`, or `.cjs` files. Pi loads extension sources directly, and Node runs the root tooling (`node scripts/release/<name>.ts`) with its built-in type stripping, so tooling uses only erasable TypeScript syntax (no `enum`, `namespace`, or parameter properties; `erasableSyntaxOnly` enforces this).
- oxfmt formats everything with its default style (`.oxfmtrc.json` only adds ignore patterns). Run `npm run format` before committing; never hand-format against it.
- oxlint lints the whole repository with the `typescript`, `unicorn`, `oxc`, and `vitest` plugins and the `correctness` category as errors (`.oxlintrc.json`), and `npm run lint` passes `--deny-warnings`. `npm run lint` then runs `npm run lint:tooling`, which checks `scripts/` and `.changeset/` with `.oxlintrc.tooling.json`: type-aware rules (through `oxlint-tsgolint` and the root `tsconfig.json`), the `correctness`, `suspicious`, `pedantic`, and `perf` categories, and strict rules such as `no-explicit-any`, `no-unsafe-*`, `strict-boolean-expressions`, `prefer-readonly-parameter-types`, `explicit-function-return-type`, and `switch-exhaustiveness-check`, all as errors. Fix the finding; do not disable the rule.
- Relative imports carry the `.ts` extension (`./config.ts`). Node built-ins use the `node:` prefix.
- Use `import type` / `export type` for type-only imports (`verbatimModuleSyntax` is on).
- Files are kebab-case. Types and classes are PascalCase, everything else camelCase. Commands are kebab-case (what the user types, for example `/toggle-fast`).
- Package names are `@indexyz/<directory name>`. Runtime identifiers (commands, settings files such as `sub2api.json`, session entry types, custom message types) never derive from or change with the npm name.

## TypeScript settings

Each package has its own `tsconfig.json`; they share these compiler options:

| Option                                                              | Consequence                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `strict`                                                            | No implicit `any`, strict null checks, `unknown` in `catch`. Narrow before use. |
| `verbatimModuleSyntax`                                              | Type-only imports must be written as `import type`.                             |
| `module` / `moduleResolution` `NodeNext`, `target` / `lib` `ES2023` | Modern ESM; relative imports need explicit extensions.                          |
| `allowImportingTsExtensions`, `noEmit`                              | Pi loads `.ts` sources directly; `tsc` only typechecks.                         |
| `skipLibCheck`, `types: ["node"]`                                   | Declaration files of dependencies are not checked; Node types are available.    |

The root `tsconfig.json` checks the repository tooling (`scripts/`, `.changeset/`) with every strictness option on top of `strict`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `erasableSyntaxOnly`, `isolatedModules`, and `skipLibCheck: false`. `npm run typecheck` runs it before the package typechecks.

`include` differs by package: single-module packages list `index.ts`, `test/**/*.ts`, and `vitest.config.ts`; multi-module packages (`pi-provider-sub2api`, `pi-custom-provider`) include `*.ts` and `test/**/*.ts`. When you add a module to a package whose `include` lists files explicitly, add it there too.

Do not use `@ts-ignore` or `@ts-expect-error`, and do not weaken a package's `tsconfig.json`. If Pi's types make something impossible, read the declarations of the installed `@earendil-works/pi-coding-agent` (`docs/pi-reference.md`) and model the code after a shipped example.

## Dependencies

- Host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`): `peerDependencies` with `"*"`, plus an exact pin in the package's `devDependencies` for types and tests. Never `dependencies`, never bundled.
- Each package pins its own Pi version. Keep a package's `@earendil-works/*` dev dependencies on one version. Raise a package's pin when it needs a newer host API, and say in its README which Pi version it requires (as `pi-autocompact` does); the upgrade procedure is in `docs/workflow.md`.
- Prefer Node built-ins and the host packages before adding a dependency. Add a runtime dependency only when it removes real complexity, add it to the package (never the root), and run `npm install` so `package-lock.json` updates.
- Per-package dev tooling (`typescript`, `vitest`, `@types/node`) lives in each package's `devDependencies`; the root `devDependencies` hold only repository tooling (oxlint, oxfmt, changesets).

## Extension design

These follow from Pi's extension contract; `docs/pi-reference.md` says where it is documented.

- The default export registers capabilities (commands, providers, event handlers) and returns. Pi may load extensions without starting a session, so do not start processes, timers, sockets, or watchers from it. Start session-scoped work in `session_start` or in the command or event handler that needs it, and release it in an idempotent `session_shutdown` handler.
- Treat `ctx` as valid only for the duration of the handler that received it.
- Extensions must keep working in print, JSON, and RPC modes; guard interactive UI behind the checks Pi documents.
- User-facing feedback goes through `ctx.ui` (notifications, status, footer). Diagnostic logging that is not meant for the conversation uses `console.warn` / `console.error` with a `[<topic>]` or `[<topic>:<provider>]` prefix, as the provider packages do. Never log secrets such as API keys or command output used as credentials.
- Fail loudly with a message that says what was expected; never swallow an error silently.

## Tests

- Vitest, files under `<name>/test/*.test.ts`, configured by the package's `vitest.config.ts`. `npm test` runs every package's tests; `npm run test --workspace @indexyz/<name>` runs one.
- Test implementation modules directly; keep `index.ts` thin so most logic is testable without a running Pi.
- Every bug fix adds a test that failed before the fix.
- The root release tooling is tested with Node's built-in runner on its `.ts` test files (`npm run test:scripts`), not Vitest. Test helpers live next to the tests (`scripts/release/test/`).

## Documentation

- Each package has a `README.md` with its purpose, an install section (`pi install npm:@indexyz/<name>`, the tag format `@indexyz/<name>@<version>`, and `pi -e ./<name>/index.ts` for a checkout), every command and setting it registers, and its configuration locations. Never state that a version is released before it is.
- Each package's `CHANGELOG.md` keeps its history. New sections are generated by `changeset version` from release intent summaries and reviewed by hand; their prose is the release notes. Write summaries for users, not from commit messages.
- The root `README.md` package table lists every package with its description.
- Comments explain why, not what. No commented-out code, no change logs in comments.
