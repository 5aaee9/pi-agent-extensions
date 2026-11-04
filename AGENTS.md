# AGENTS.md

This npm workspace holds agent plugins for two unrelated hosts. `pi-<topic>/` packages extend [Pi](https://pi.dev); `dsh-<topic>/` packages extend [dsh](https://github.com/deepseek-ai/deepseek-harness), the DeepSeek Harness. Each package directory is published on its own as `@indexyz/<directory>`, and the root holds only shared tooling and documentation.

## Keep the two plugin systems apart

Pi and dsh differ in API, build model, load path, and verification, and their packages share a repository but no runtime. Unless the user explicitly asks to cross systems:

- Change, build, and test only packages in the system you are working on.
- Release only that system's packages.
- Report a failure in the other system instead of fixing it.

The root scripts `check`, `format`, `format:check`, `lint`, `lint:fix`, `typecheck`, `build`, `test`, a bare `test:e2e`, and a bare `release:version` span both systems. Run them only for a change to shared root tooling or on request; `docs/workflow.md` and `docs/releases.md` give the scoped forms.

## Always

- Work is done when verified through its own host (`docs/workflow.md`, "Verify"). Report what you ran, not what you assume.
- Plan non-trivial work with OpenSpec, from the package directory for package work (`docs/workflow.md`).
- A change to a package's published content records its release decision in the same change (`docs/releases.md`).
- Preparing versions, pushing a preparation to `main`, merging a release pull request, and dispatching the publish workflow each need an explicit request for that action, because a push to `main` that carries a new version publishes it without further approval.
- Answer host API questions from the installation the package pins, not from memory; both hosts change quickly.
- Use npm only; `package-lock.json` is the only lockfile.
- Keep agent configuration in this file and `.agents/`. `.claude` is a symlink to `.agents`, and `CLAUDE.md` is exactly `@AGENTS.md`.

## Where to read

Read the row that matches your task before editing. Each document links what it does not cover.

| When you                                              | Read                                                      |
| ----------------------------------------------------- | --------------------------------------------------------- |
| change or debug a `pi-<topic>/` package               | `docs/pi/README.md`, through the `pi-extension-dev` skill |
| create a `pi-<topic>/` package                        | `docs/pi/new-package.md`                                  |
| look up Pi's API, docs, or types                      | `docs/pi/reference.md`                                    |
| change or debug a `dsh-<topic>/` package              | `docs/dsh/README.md`                                      |
| create a `dsh-<topic>/` package                       | `docs/dsh/new-package.md`                                 |
| write code or tests, choose dependencies, or commit   | `docs/conventions.md`                                     |
| plan, verify, or remove a package                     | `docs/workflow.md`                                        |
| record a release decision or prepare a release        | `docs/releases.md`                                        |
| debug the release gate or a publication, or retry one | `docs/releases/ci.md`                                     |
| publish a new npm package for the first time          | `docs/releases/first-release.md`                          |
| change root tooling or need the repository layout     | `docs/architecture.md`                                    |
