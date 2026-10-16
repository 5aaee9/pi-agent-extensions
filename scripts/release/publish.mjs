// Publish step (CI only; needs npm trusted publishing and contents: write):
//   node scripts/release/publish.mjs --dir <dir>
// Uploads the tarballs verified by plan.mjs, then creates missing tags and
// GitHub Releases for every published version in the plan.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { runChecked } from "./exec.mjs";
import { git, manifestVersionAt, showFile, tagCommit } from "./git.mjs";
import { createRelease, releaseState } from "./github.mjs";
import { npmPublish, registryHas } from "./npm.mjs";
import { runPublish } from "./publish-core.mjs";

const { values } = parseArgs({ options: { dir: { type: "string" } } });
if (!values.dir) {
  console.error("usage: node scripts/release/publish.mjs --dir <dir>");
  process.exit(2);
}
const dir = resolve(values.dir);
const plan = JSON.parse(readFileSync(join(dir, "release-plan.json"), "utf8"));
const cwd = git(["rev-parse", "--show-toplevel"]);

const result = runPublish(
  {
    uploads: plan.uploads.map((upload) => ({ ...upload, tarball: join(dir, upload.tarball) })),
    records: plan.records,
  },
  {
    sha256: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
    npmPublish,
    registryHas,
    tagCommit: (tag) => tagCommit(tag, cwd),
    manifestVersionAt: (commit, pkgDir) => manifestVersionAt(commit, pkgDir, cwd),
    createTag: (tag, commit) => runChecked("git", ["tag", tag, commit], { cwd }),
    pushTag: (tag) => runChecked("git", ["push", "origin", `refs/tags/${tag}`], { cwd }),
    changelogAt: (commit, pkgDir) => showFile(commit, `${pkgDir}/CHANGELOG.md`, cwd),
    releaseExists: (tag) => releaseState(tag) === "present",
    createRelease,
    log: (line) => console.log(line),
  },
);

const rows = [...result.outcomes].map(
  ([name, o]) => `| ${name}@${o.version} | ${o.upload} | ${o.tag} | ${o.release} |`,
);
const report = [
  `Release run for ${plan.commit}`,
  "",
  "| Package | Upload | Tag | GitHub Release |",
  "|---|---|---|---|",
  ...rows,
  "",
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
for (const error of result.errors) console.error(`error: ${error}`);
process.exit(result.ok ? 0 : 1);
