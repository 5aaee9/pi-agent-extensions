# Create a dsh package

Run these from the repository root unless a step says otherwise. Read `docs/dsh/README.md` first, and model the package on the existing `dsh-<topic>/` package closest to what you are building.

1. Choose a name: `dsh-<topic>`, lowercase, hyphenated. The directory is `dsh-<topic>/` at the repository root, the npm `name` is `@indexyz/dsh-<topic>`, and the commit scope is `<topic>` (spelled out when a `pi-<topic>/` package would share it). Copy the root `LICENSE` into it.
2. Its `package.json` declares a `dsh` manifest (`dsh.bundle.patch`, `dsh.client`) and no `pi` manifest, its build scripts (`build`, `build:host` with `tsc -p tsconfig.build.json`, `build:client` with `tsdown`), and `"release": { "smoke": "test/smoke-release.ts" }`. Its imported `@deepseek-ai/*` hosts are exact `devDependencies` pins with `"*"` peers.
3. Its build output (`lib/` and, when present, `client.js`) is Git-ignored and never committed. `files` ships it, and `prepack` runs `check` to build and test it before packing.
4. Add the directory to the root `package.json` `workspaces` array, and never to the root `pi.extensions`. Run `npm install` so the workspace links the package and `package-lock.json` records it.
5. Initialize the package's OpenSpec root, without generating harness files inside the package, and set its context:

   ```bash
   npx openspec init dsh-<topic> --tools none --no-animation
   ```

   ```yaml
   schema: spec-driven

   context: |
     Scope: the dsh-<topic> plugin in this directory only (npm package
     @indexyz/dsh-<topic>). Repository-wide concerns belong to the repository
     root's openspec/.
     Constraints: follow ../AGENTS.md, ../docs/conventions.md, and
     ../docs/dsh/README.md. This directory is excluded from the published package
     (it is not in "files").
     Verification for every change: the commands in ../docs/dsh/README.md,
     "Verify", and a release decision for @indexyz/dsh-<topic> per
     ../docs/releases.md when published files change.
   ```

6. Propose the first change from `dsh-<topic>/`, then implement it following `docs/conventions.md`. Answer API questions from the pinned installation (`docs/dsh/README.md`, "Hosts").
7. Verify with `docs/dsh/README.md`, "Verify".
8. Write the package `README.md` and add a row to the table in the root `README.md`.
9. Record the release decision (`docs/releases.md`): `npm run change -- --minor @indexyz/dsh-<topic> -m "First release: <what it does>"` when it should ship, or a `none` intent with the reason it should not ship yet. The first upload follows `docs/releases/first-release.md`; the new package's GitHub push waits for the owner's confirmation there.
10. Archive the change, then commit: `feat(<topic>): <summary>`.
