# Workflow

## Plan with OpenSpec

Non-trivial work (a new extension, a new command or provider feature, a behavior change, a removal) is planned with OpenSpec before code is written. Trivial fixes (typos, a one-line bug with an obvious test) can skip it.

Two roots exist, and the CLI picks the nearest one above the working directory:

| Work                                                    | Working directory                   | Root               |
| ------------------------------------------------------- | ----------------------------------- | ------------------ |
| One package                                             | `<name>/` (for example `pi-skill/`) | `<name>/openspec/` |
| Repository-wide (tooling, workflows, docs, conventions) | repository root                     | `openspec/`        |

Always run `openspec` from the directory in the table; from the repository root, a package change would land in the wrong root. Check with `openspec context --json` when unsure: `root.path` must be the package directory for package work.

The workflow is the standard OpenSpec one, available as skills in `.agents/skills/` (`openspec-propose`, `openspec-apply-change`, `openspec-archive-change`, ...) and as `/opsx:*` commands in Claude Code:

1. Propose: creates `openspec/changes/<change>/` with `proposal.md`, spec deltas, `design.md`, `tasks.md`. Stop and let the user review.
2. Apply: implement the tasks, checking them off as they are verified.
3. Archive: merges spec deltas into `openspec/specs/` and moves the change to `changes/archive/`.

A package's `openspec/specs/` is the current description of what that extension does; keep it truthful when archiving.

## Create a new extension

1. Choose a name: `pi-<topic>`, lowercase, hyphenated. The directory is `pi-<topic>/` at the repository root, the npm `name` is `@indexyz/pi-<topic>`, and the commit scope is `<topic>`.
2. Create the package from the templates below (copy the root `LICENSE` into it). Replace `<topic>` and the placeholder text.
3. Add the directory to the root `package.json` `workspaces` array and its entry (`./pi-<topic>/index.ts`) to the root `pi.extensions` array.
4. Initialize the package's OpenSpec root and set its context:

   ```bash
   openspec init pi-<topic> --tools none --no-animation
   ```

   `--tools none` keeps agent command and skill files at the repository root only; never generate harness files inside a package. Then replace `pi-<topic>/openspec/config.yaml` with the context the other packages use:

   ```yaml
   schema: spec-driven

   context: |
     Scope: the pi-<topic> extension in this directory only (npm package
     @indexyz/pi-<topic>). Repository-wide concerns belong to the repository
     root's openspec/.
     Constraints: follow ../AGENTS.md and ../docs/conventions.md. This
     directory is excluded from the published package (it is not in "files").
     Verification for every change: npm run check from the repository root, the
     load smoke test in ../docs/workflow.md, and a release decision for
     @indexyz/pi-<topic> per ../docs/releases.md when published files change.
   ```

5. Run `npm install` so the workspace links the package and `package-lock.json` records it.
6. Propose the first change from `pi-<topic>/`, then implement it following `docs/conventions.md`. Consult Pi's docs and the closest shipped example (`docs/pi-reference.md`) before using an API.
7. Verify (next section).
8. Write the package `README.md` and add a row to the table in the root `README.md`.
9. Record the release decision (`docs/releases.md`): `npm run change -- --minor @indexyz/pi-<topic> -m "First release: <what it does>"` when it should ship (the template's `0.0.0` becomes `0.1.0` at the first preparation), or a `none` intent with the reason it should not ship yet. The first upload of a new package needs the owner (`docs/releases.md`, "First release of a new package").
10. Archive the change, then commit: `feat(<topic>): <summary>`.

### `pi-<topic>/package.json`

```json
{
  "name": "@indexyz/pi-<topic>",
  "version": "0.0.0",
  "description": "<one sentence>",
  "keywords": ["pi", "pi-package"],
  "homepage": "https://github.com/5aaee9/pi-agent-extensions/tree/main/pi-<topic>#readme",
  "bugs": {
    "url": "https://github.com/5aaee9/pi-agent-extensions/issues"
  },
  "license": "MIT",
  "author": "5aaee9",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/5aaee9/pi-agent-extensions.git",
    "directory": "pi-<topic>"
  },
  "files": ["index.ts", "README.md", "CHANGELOG.md", "LICENSE"],
  "type": "module",
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test",
    "prepack": "npm run check"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.84.0",
    "@types/node": "^24.0.0",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "engines": {
    "node": ">=22.19.0"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

List every shipped file in `files`: each `.ts` module the extension imports, `README.md`, `CHANGELOG.md`, `LICENSE`, and any data file. Add `@earendil-works/pi-ai` or `@earendil-works/pi-tui` to both `peerDependencies` (`"*"`) and `devDependencies` (the same exact version as `pi-coding-agent`) when the code imports them. Pin the Pi version the package needs; `0.84.0` is what most packages use today. Do not add `private`.

### `pi-<topic>/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true
  },
  "include": ["*.ts", "test/**/*.ts"]
}
```

### `pi-<topic>/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
```

### `pi-<topic>/index.ts`, a module, and its test

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { greeting } from "./greeting.ts";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("hello", {
    description: "Show a greeting",
    handler: async (args, ctx) => {
      ctx.ui.notify(greeting(args), "info");
    },
  });
}
```

```ts
// greeting.ts
export function greeting(name: string): string {
  return `Hello, ${name.trim() || "world"}!`;
}
```

```ts
// test/greeting.test.ts
import { describe, expect, it } from "vitest";

import { greeting } from "../greeting.ts";

describe("greeting", () => {
  it("greets by name", () => {
    expect(greeting("Pi")).toBe("Hello, Pi!");
  });
});
```

Add `greeting.ts` to `files`.

### `pi-<topic>/CHANGELOG.md`

```markdown
# Changelog
```

`changeset version` adds the first `## <version>` section below this heading.

### `pi-<topic>/README.md`

````markdown
# @indexyz/pi-<topic>

<What it does and why, in one paragraph.>

## Install

```bash
pi install npm:@indexyz/pi-<topic>
```

Releases are published to npm as `@indexyz/pi-<topic>`; each release is tagged `@indexyz/pi-<topic>@<version>`.

To try a repository checkout for one session (after `npm install` at the repository root):

```bash
pi -e ./pi-<topic>/index.ts
```

## Usage

<Commands, providers, and settings it registers.>

## Development

```bash
npm install
npm run check --workspace @indexyz/pi-<topic>
```

## License

MIT
````

## Verify

Every change ends with all of these, run from the repository root:

1. `npm run check`: oxfmt, oxlint, every package's `tsc` and Vitest, and the release-script tests must all pass.
2. Load smoke test without a model call, after `npm install`:

   ```bash
   printf '{"id":"1","type":"get_commands"}\n' | node_modules/.bin/pi -ne -e ./pi-skill/index.ts --mode rpc
   ```

   Replace `pi-skill` with the package you changed. When the package pins a Pi version different from the root's (today `pi-autocompact`), use its own binary: `pi-autocompact/node_modules/.bin/pi`. Exit code 0 and a `"success":true` response listing the package's commands mean the extension loaded. A load failure prints `Failed to load extension` and exits non-zero.

3. For behavior that needs a live session (providers, UI, events), run `pi -e ./<name>/index.ts` interactively and exercise the feature. State in the final report exactly what was exercised.
4. Release-impact gate, as CI runs it on pull requests, once the change is committed on a branch: `npm run release:gate -- --base origin/main --head HEAD`. It fails when a package's published content changed without a release decision (`docs/releases.md`).

A running Pi session keeps the extension code it loaded at startup. After editing a package, restart Pi (or `/reload`) before testing again.

## Change an existing extension

1. Read the package README, `openspec/specs/`, and `index.ts` first, then the modules you touch.
2. For non-trivial changes, propose from `<name>/` and wait for review.
3. Make the change with its test. Keep the package's public surface (command names, provider names, settings files) stable unless the change is the point. Add new modules to `files` (and to `tsconfig.json` `include` if it lists files explicitly).
4. Update the README when commands, flags, or configuration change.
5. Record the release decision (`docs/releases.md`): `npm run change -- --<patch|minor|major> @indexyz/<name> -m "<summary>"`, or a `none` intent with a reason. A change that affects several packages records one intent file per package.
6. Verify, archive the change, then commit as `fix(<topic>): ...` or `feat(<topic>): ...`.

## Remove an extension

Delete `<name>/` (its OpenSpec root goes with it), remove it from the root `package.json` `workspaces` and `pi.extensions`, remove its row from the root README, delete any pending intent naming it from `.changeset/`, run `npm install` to update the lockfile, and commit as `chore(repo): remove <name>`. Versions already on npm stay there; never unpublish them.

## Release

Releasing is a separate step taken only on an explicit request: prepare versions locally, review, and push the preparation to `main` (directly or through a pull request) only when asked; CI then publishes what is missing from the registry. The procedure, including recovery, is `docs/releases.md`.

## Upgrade Pi

Each package pins the Pi host packages it builds against in its own `devDependencies` (`docs/pi-reference.md`). To upgrade one package: bump all of its `@earendil-works/*` dev dependencies together to the new exact version, run `npm install`, read that version's `CHANGELOG.md` (under the package's `node_modules/@earendil-works/pi-coding-agent/` when it differs from the root's, otherwise the root's) for breaking changes, update the README if the package now requires a newer Pi, run `npm run check`, and smoke-test the package with the matching `pi` binary. The upgrade changes `package.json`, a published file, so it needs a release decision.
