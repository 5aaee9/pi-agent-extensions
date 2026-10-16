// Publication plan (read-only):
//   node scripts/release/plan.ts --out <dir>      (CI)
//   node scripts/release/plan.ts --dry-run        (local preview)
// Finds package versions absent from the registry, builds and verifies each
// one at its version commit, and lists missing tags and GitHub Releases.
// Writes <dir>/release-plan.json and, in CI, `publish=true|false` to
// GITHUB_OUTPUT. Nothing is published and nothing is written to GitHub.
import { parseArgs } from "node:util";

import { createPlanOps } from "./adapters.ts";
import { buildUpload } from "./build.ts";
import { errorMessage, runChecked } from "./exec.ts";
import { git, showFile } from "./git.ts";
import { validateIntentFiles } from "./intents.ts";
import { planPackages } from "./plan-core.ts";
import {
  appendGithubFile,
  type BuiltUpload,
  prepareOutputDir,
  writeReleasePlan,
} from "./release-plan.ts";
import { listPackages } from "./workspace.ts";

function fail(messages: readonly string[]): never {
  for (const message of messages) {
    console.error(`error: ${message}`);
  }
  process.exit(1);
}

const { values } = parseArgs({
  options: { out: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const dryRun = values["dry-run"];
if (values.out === undefined && !dryRun) {
  console.error("usage: node scripts/release/plan.ts --out <dir> | --dry-run [--out <dir>]");
  process.exit(2);
}
const out = prepareOutputDir(values.out);

const cwd = git(["rev-parse", "--show-toplevel"]);
const head = git(["rev-parse", "HEAD"], cwd);
const packages = listPackages((path) => showFile(head, path, cwd));

// Every remaining intent file must be valid before anything is planned.
const intentProblems = await validateIntentFiles(
  cwd,
  packages.map((pkg) => pkg.name),
);
if (intentProblems.length > 0) {
  fail(intentProblems);
}

runChecked("git", ["fetch", "--quiet", "--tags", "origin"], { cwd });

const plan = planPackages(packages, createPlanOps(cwd, head, dryRun));
for (const notice of plan.notices) {
  console.log(`notice: ${notice}`);
}
if (plan.errors.length > 0) {
  fail(plan.errors);
}

let uploads: BuiltUpload[] = [];
try {
  uploads = plan.uploads.map((upload) => buildUpload(upload, cwd, out));
} catch (error) {
  fail([errorMessage(error)]);
}

const planPath = writeReleasePlan(out, { commit: head, uploads, records: plan.records });
const publish = uploads.length > 0 || plan.records.length > 0;

for (const upload of uploads) {
  console.log(`upload: ${upload.name}@${upload.version} from ${upload.versionCommit.slice(0, 7)}`);
}
for (const record of plan.records) {
  const work = [record.needsTag ? "tag" : "", record.needsRelease ? "release" : ""]
    .filter((item) => item !== "")
    .join(" + ");
  console.log(
    `record: ${record.name}@${record.version} ${work} at ${record.recordCommit.slice(0, 7)}`,
  );
}
console.log(publish ? `plan written to ${planPath}` : "nothing to publish or record");
const githubOutput = process.env["GITHUB_OUTPUT"];
if (dryRun) {
  console.log("dry run: nothing was published or recorded");
} else if (githubOutput !== undefined) {
  appendGithubFile(githubOutput, `publish=${String(publish)}\n`);
}
