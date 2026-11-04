# Create a Pi package

Run these from the repository root unless a step says otherwise. Read `docs/pi/README.md` first.

1. Choose a name: `pi-<topic>`, lowercase, hyphenated. The directory is `pi-<topic>/` at the repository root, the npm `name` is `@indexyz/pi-<topic>`, and the commit scope is `<topic>`.
2. Create the package from the templates below (copy the root `LICENSE` into it). Replace `<topic>` and the placeholder text.
3. Add the directory to the root `package.json` `workspaces` array and its entry (`./pi-<topic>/index.ts`) to the root `pi.extensions` array.
4. Initialize the package's OpenSpec root and set its context:

   ```bash
   npx openspec init pi-<topic> --tools none --no-animation
   ```

   `--tools none` keeps agent command and skill files at the repository root only; never generate harness files inside a package. Then replace `pi-<topic>/openspec/config.yaml` with the context the other packages use:

   ```yaml
   schema: spec-driven

   context: |
     Scope: the pi-<topic> extension in this directory only (npm package
     @indexyz/pi-<topic>). Repository-wide concerns belong to the repository
     root's openspec/.
     Constraints: follow ../AGENTS.md, ../docs/conventions.md, and
     ../docs/pi/README.md. This directory is excluded from the published package
     (it is not in "files").
     Verification for every change: the commands in ../docs/pi/README.md,
     "Verify", and a release decision for @indexyz/pi-<topic> per
     ../docs/releases.md when published files change.
   ```

5. Run `npm install` so the workspace links the package and `package-lock.json` records it.
6. Add the package's entry to `scripts/e2e/pi/registrations.ts`, naming the commands and models it registers or another observable effect; `npm run test:e2e:pi` fails until it has one.
7. Propose the first change from `pi-<topic>/`, then implement it following `docs/conventions.md`. Behaviour that depends on Pi gets a scenario in `scripts/e2e/pi/<name>.e2e.ts` when it names a real failure (`docs/pi/README.md`, "Tests"). Consult Pi's docs and the closest shipped example (`docs/pi/reference.md`) before using an API.
8. Verify with `docs/pi/README.md`, "Verify".
9. Write the package `README.md` and add a row to the table in the root `README.md`.
10. Record the release decision (`docs/releases.md`): `npm run change -- --minor @indexyz/pi-<topic> -m "First release: <what it does>"` when it should ship (the template's `0.0.0` becomes `0.1.0` at the first preparation), or a `none` intent with the reason it should not ship yet. The first upload follows `docs/releases/first-release.md`; the new package's GitHub push waits for the owner's confirmation there.
11. Archive the change, then commit: `feat(<topic>): <summary>`.

## Templates

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
    "@earendil-works/pi-coding-agent": "1.5.0",
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

List every shipped file in `files`: each `.ts` module the extension imports, `README.md`, `CHANGELOG.md`, `LICENSE`, and any data file. Add `@earendil-works/pi-ai` or `@earendil-works/pi-tui` to both `peerDependencies` (`"*"`) and `devDependencies` (the same exact version as `pi-coding-agent`) when the code imports them. Pin the Pi version the package needs; `1.5.0` is the current shared verification baseline. Do not add `private`.

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
