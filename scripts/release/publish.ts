// Publish step (CI only; needs npm trusted publishing and contents: write):
//   node scripts/release/publish.ts --dir <dir>
// Uploads the tarballs verified by plan.ts, waits out registry propagation,
// then creates missing tags and GitHub Releases for every published version in
// the plan.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { createPublishOps } from "./adapters.ts";
import { git } from "./git.ts";
import { runPublish } from "./publish-core.ts";
import { appendGithubFile, readReleasePlan } from "./release-plan.ts";

const { values } = parseArgs({ options: { dir: { type: "string" } } });
if (values.dir === undefined) {
  console.error("usage: node scripts/release/publish.ts --dir <dir>");
  process.exit(2);
}
const dir = resolve(values.dir);
const plan = readReleasePlan(dir);
const cwd = git(["rev-parse", "--show-toplevel"]);

const result = runPublish(
  {
    uploads: plan.uploads.map((upload) => ({ ...upload, tarball: join(dir, upload.tarball) })),
    records: plan.records,
  },
  createPublishOps(cwd),
);

const rows: string[] = [];
for (const outcome of result.outcomes) {
  const { name, version, upload, tag, release } = outcome;
  rows.push(`| ${name}@${version} | ${upload} | ${tag} | ${release} |`);
}
const report = [
  `Release run for ${plan.commit}`,
  "",
  "| Package | Upload | Tag | GitHub Release |",
  "|---|---|---|---|",
  ...rows,
  "",
].join("\n");
console.log(report);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined) {
  appendGithubFile(summary, `${report}\n`);
}
for (const error of result.errors) {
  console.error(`error: ${error}`);
}
process.exit(result.ok ? 0 : 1);
