// Pull-request release-impact gate:
//   node scripts/release/gate.ts --base <base sha> --head <head sha>
// Every package whose published files changed needs a release decision
// contributed by the pull request (docs/releases.md).
import { parseArgs } from "node:util";

import { decidePackage, decisionHelp } from "./gate-core.ts";
import { git, manifestVersionAt, showFile } from "./git.ts";
import { intentPackage, isIntentPath, validateIntent } from "./intents.ts";
import { listPackages } from "./workspace.ts";

const { values } = parseArgs({
  options: { base: { type: "string" }, head: { type: "string" } },
});
if (values.base === undefined || values.head === undefined) {
  console.error("usage: node scripts/release/gate.ts --base <ref> --head <ref>");
  process.exit(2);
}

const cwd = git(["rev-parse", "--show-toplevel"]);
const head = git(["rev-parse", "--verify", `${values.head}^{commit}`], cwd);
const mergeBase = git(["merge-base", values.base, head], cwd);
const atHead = (path: string): string | null => showFile(head, path, cwd);
const atBase = (path: string): string | null => showFile(mergeBase, path, cwd);

const packages = listPackages(atHead);
const names = packages.map((pkg) => pkg.name);
const problems: string[] = [];

// Every intent at head must be valid, whether or not this pull request added it.
const headIntents = git(["ls-tree", "--name-only", head, ".changeset/"], cwd)
  .split("\n")
  .filter((path) => isIntentPath(path));
for (const path of headIntents) {
  problems.push(...validateIntent(path, atHead(path) ?? "", names));
}

// Intents this pull request added, modified, or deleted, by package name.
const touched = new Set<string>();
const deleted = new Set<string>();
const intentChanges = git(
  ["diff", "--name-status", "--no-renames", mergeBase, head, "--", ".changeset/"],
  cwd,
);
for (const line of intentChanges.split("\n")) {
  const [status, path] = line.split("\t");
  if (status === undefined || path === undefined || !isIntentPath(path)) {
    continue;
  }
  const name = intentPackage((status === "D" ? atBase(path) : atHead(path)) ?? "");
  if (name !== undefined) {
    (status === "D" ? deleted : touched).add(name);
  }
}

const changed = git(["diff", "--name-only", "--no-renames", mergeBase, head], cwd)
  .split("\n")
  .filter((path) => path !== "");

let failed = problems.length > 0;
for (const problem of problems) {
  console.error(`error: ${problem}`);
}

for (const pkg of packages) {
  const prefix = `${pkg.dir}/`;
  const decision = decidePackage({
    changedPaths: changed
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length)),
    files: pkg.manifest.files,
    baseVersion: manifestVersionAt(mergeBase, pkg.dir, cwd),
    headVersion: pkg.version,
    baseChangelog: atBase(`${pkg.dir}/CHANGELOG.md`),
    headChangelog: atHead(`${pkg.dir}/CHANGELOG.md`),
    touchedIntent: touched.has(pkg.name),
    deletedIntent: deleted.has(pkg.name),
  });
  if (decision.status === "none") {
    console.log(`${pkg.name}: no published changes`);
  } else if (decision.status === "pass") {
    console.log(`${pkg.name}: ok (${decision.reason})`);
  } else {
    failed = true;
    const files = decision.published.map((path) => prefix + path).join(", ");
    console.error(`${pkg.name}: ${decision.reason}`);
    console.error(`  changed published files: ${files}`);
    console.error(decisionHelp(pkg.name));
  }
}

console.log(`compared ${mergeBase.slice(0, 7)} (merge base) with ${head.slice(0, 7)}`);
process.exit(failed ? 1 : 0);
