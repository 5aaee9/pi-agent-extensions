// Pull-request release-impact gate:
//   node scripts/release/gate.mjs --base <base sha> --head <head sha>
// Every package whose published files changed needs a release decision
// contributed by the pull request (docs/releases.md).
import { parseArgs } from "node:util";

import { decidePackage, decisionHelp } from "./gate-core.mjs";
import { git, showFile } from "./git.mjs";
import { intentPackage, isIntentPath, validateIntent } from "./intents.mjs";
import { listPackages } from "./workspace.mjs";

const { values } = parseArgs({
  options: { base: { type: "string" }, head: { type: "string" } },
});
if (!values.base || !values.head) {
  console.error("usage: node scripts/release/gate.mjs --base <ref> --head <ref>");
  process.exit(2);
}

const cwd = git(["rev-parse", "--show-toplevel"]);
const head = git(["rev-parse", "--verify", `${values.head}^{commit}`], cwd);
const mergeBase = git(["merge-base", values.base, head], cwd);

const packages = listPackages((path) => showFile(head, path, cwd));
const names = packages.map((pkg) => pkg.name);
const problems = [];

// Every intent at head must be valid, whether or not this pull request added it.
const headIntents = git(["ls-tree", "--name-only", head, ".changeset/"], cwd)
  .split("\n")
  .filter(isIntentPath);
for (const path of headIntents) {
  problems.push(...validateIntent(path, showFile(head, path, cwd), names));
}

// Intents this pull request added, modified, or deleted, by package name.
const touched = new Set();
const deleted = new Set();
for (const line of git(
  ["diff", "--name-status", "--no-renames", mergeBase, head, "--", ".changeset/"],
  cwd,
).split("\n")) {
  if (!line) continue;
  const [status, path] = line.split("\t");
  if (!isIntentPath(path)) continue;
  if (status === "D") {
    const name = intentPackage(showFile(mergeBase, path, cwd));
    if (name) deleted.add(name);
  } else {
    const name = intentPackage(showFile(head, path, cwd));
    if (name) touched.add(name);
  }
}

const changed = git(["diff", "--name-only", "--no-renames", mergeBase, head], cwd)
  .split("\n")
  .filter(Boolean);

let failed = problems.length > 0;
for (const problem of problems) {
  console.error(`error: ${problem}`);
}

for (const pkg of packages) {
  const prefix = `${pkg.dir}/`;
  const baseManifest = showFile(mergeBase, `${pkg.dir}/package.json`, cwd);
  const decision = decidePackage({
    changedPaths: changed
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length)),
    files: pkg.manifest.files ?? [],
    baseVersion: baseManifest === null ? null : (JSON.parse(baseManifest).version ?? null),
    headVersion: pkg.version ?? null,
    baseChangelog: showFile(mergeBase, `${pkg.dir}/CHANGELOG.md`, cwd),
    headChangelog: showFile(head, `${pkg.dir}/CHANGELOG.md`, cwd),
    touchedIntent: touched.has(pkg.name),
    deletedIntent: deleted.has(pkg.name),
  });
  if (decision.status === "none") {
    console.log(`${pkg.name}: no published changes`);
  } else if (decision.status === "pass") {
    console.log(`${pkg.name}: ok (${decision.reason})`);
  } else {
    failed = true;
    console.error(`${pkg.name}: ${decision.reason}`);
    console.error(
      `  changed published files: ${decision.published.map((p) => prefix + p).join(", ")}`,
    );
    console.error(decisionHelp(pkg.name));
  }
}

console.log(`compared ${mergeBase.slice(0, 7)} (merge base) with ${head.slice(0, 7)}`);
process.exit(failed ? 1 : 0);
