// Finds the commit that introduced a package's current version:
//   node scripts/release/version-commit.ts [--head <ref>] [<dir> ...]
// The version commit is the newest first-parent commit whose <dir>/package.json
// carries the version while its first parent's copy differs or is absent.
import { parseArgs } from "node:util";

import { firstParent, git, manifestVersionAt, showFile } from "./git.ts";
import { listPackages } from "./workspace.ts";

export interface VersionCommitQuery {
  readonly cwd: string;
  readonly head?: string;
  readonly dir: string;
  readonly version: string;
}

/** Returns the version commit of `version` for `dir`, or `null` when none is found. */
export function findVersionCommit({
  cwd,
  head = "HEAD",
  dir,
  version,
}: VersionCommitQuery): string | null {
  const log = git(["log", "--first-parent", "--format=%H", head, "--", `${dir}/package.json`], cwd);
  for (const sha of log.split("\n").filter((line) => line !== "")) {
    if (manifestVersionAt(sha, dir, cwd) !== version) {
      continue;
    }
    const parent = firstParent(sha, cwd);
    const parentVersion = parent === null ? null : manifestVersionAt(parent, dir, cwd);
    if (parentVersion !== version) {
      return sha;
    }
  }
  return null;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { head: { type: "string", default: "HEAD" } },
    allowPositionals: true,
  });
  const { head } = values;
  const cwd = git(["rev-parse", "--show-toplevel"]);
  const packages = listPackages((path) => showFile(head, path, cwd)).filter(
    (pkg) => positionals.length === 0 || positionals.includes(pkg.dir),
  );
  let missing = false;
  for (const pkg of packages) {
    const sha = findVersionCommit({ cwd, head, dir: pkg.dir, version: pkg.version });
    if (sha === null) {
      missing = true;
    }
    console.log(`${pkg.name}@${pkg.version} ${sha ?? "(not found)"}`);
  }
  process.exit(missing ? 1 : 0);
}
