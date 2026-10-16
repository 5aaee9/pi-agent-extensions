// Publication plan (read-only):
//   node scripts/release/plan.mjs --out <dir>      (CI)
//   node scripts/release/plan.mjs --dry-run        (local preview)
// Finds package versions absent from the registry, builds and verifies each
// one at its version commit, and lists missing tags and GitHub Releases.
// Writes <dir>/release-plan.json and, in CI, `publish=true|false` to
// GITHUB_OUTPUT. Nothing is published and nothing is written to GitHub.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { readChangesets } from "@changesets/read";

import { run, runChecked } from "./exec.mjs";
import { git, manifestVersionAt, showFile, tagCommit } from "./git.mjs";
import { releaseState } from "./github.mjs";
import { validateIntent } from "./intents.mjs";
import { registryHas } from "./npm.mjs";
import { inspectTarball, parsePackOutput, planPackages, rpcAnswered } from "./plan-core.mjs";
import { findVersionCommit } from "./version-commit.mjs";
import { listPackages } from "./workspace.mjs";

const { values } = parseArgs({
  options: { out: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const dryRun = values["dry-run"];
if (!values.out && !dryRun) {
  console.error("usage: node scripts/release/plan.mjs --out <dir> | --dry-run [--out <dir>]");
  process.exit(2);
}
const out = resolve(values.out ?? mkdtempSync(join(tmpdir(), "release-plan-")));
mkdirSync(out, { recursive: true });

const cwd = git(["rev-parse", "--show-toplevel"]);
const head = git(["rev-parse", "HEAD"], cwd);
const readFile = (path) => showFile(head, path, cwd);
const packages = listPackages(readFile);
const names = packages.map((pkg) => pkg.name);

function fail(messages) {
  for (const message of messages) console.error(`error: ${message}`);
  process.exit(1);
}

// Every remaining intent file must be valid before anything is planned.
let intents;
try {
  intents = await readChangesets(cwd);
} catch (error) {
  fail([`cannot read release intents: ${error instanceof Error ? error.message : error}`]);
}
const intentProblems = intents.flatMap((intent) =>
  validateIntent(
    `.changeset/${intent.id}.md`,
    readFileSync(join(cwd, ".changeset", `${intent.id}.md`), "utf8"),
    names,
  ),
);
if (intentProblems.length > 0) fail(intentProblems);

runChecked("git", ["fetch", "--quiet", "--tags", "origin"], { cwd });

const plan = planPackages(packages, {
  versionCommit: (pkg) => findVersionCommit({ cwd, head, dir: pkg.dir, version: pkg.version }),
  registryHas,
  tagCommit: (tag) => tagCommit(tag, cwd),
  manifestVersionAt: (commit, dir) => manifestVersionAt(commit, dir, cwd),
  changelogAt: (commit, dir) => showFile(commit, `${dir}/CHANGELOG.md`, cwd),
  releaseState: (tag) => {
    try {
      return releaseState(tag);
    } catch (error) {
      if (dryRun) return "unknown";
      throw error;
    }
  },
});
for (const notice of plan.notices) console.log(`notice: ${notice}`);
if (plan.errors.length > 0) fail(plan.errors);

/** Builds, inspects, and smoke-loads one upload at its version commit. */
function buildUpload(upload) {
  const work = mkdtempSync(join(tmpdir(), "release-build-"));
  const worktree = join(work, "worktree");
  const label = `${upload.name}@${upload.version}`;
  console.log(`building ${label} at ${upload.versionCommit.slice(0, 7)}`);
  runChecked("git", ["worktree", "add", "--quiet", "--detach", worktree, upload.versionCommit], {
    cwd,
  });
  try {
    runChecked("npm", ["ci", "--no-audit", "--no-fund"], { cwd: worktree });
    const packed = parsePackOutput(
      runChecked("npm", ["pack", "--workspace", upload.name, "--pack-destination", out, "--json"], {
        cwd: worktree,
      }),
    );
    const tarball = packed[0].filename.split("/").pop();
    const path = join(out, tarball);

    const entries = runChecked("tar", ["-tzf", path])
      .split("\n")
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, ""));
    const problems = inspectTarball({
      name: upload.name,
      version: upload.version,
      manifest: JSON.parse(readFileSync(join(worktree, upload.dir, "package.json"), "utf8")),
      entries,
      packed: JSON.parse(runChecked("tar", ["-xzOf", path, "package/package.json"])),
    });
    if (problems.length > 0) {
      throw new Error(`${label}: tarball inspection failed:\n  ${problems.join("\n  ")}`);
    }

    // Install as Pi installs packages (no peers), then load it in the pinned host.
    const install = join(work, "install");
    mkdirSync(install);
    writeFileSync(join(install, "package.json"), '{ "name": "release-smoke", "private": true }\n');
    runChecked(
      "npm",
      ["install", "--omit=peer", "--no-package-lock", "--no-audit", "--no-fund", path],
      {
        cwd: install,
      },
    );
    const ownPi = join(worktree, upload.dir, "node_modules", ".bin", "pi");
    const pi = existsSync(ownPi) ? ownPi : join(worktree, "node_modules", ".bin", "pi");
    const agentDir = join(work, "agent");
    mkdirSync(agentDir);
    const smoke = run(
      pi,
      ["-ne", "-e", join(install, "node_modules", upload.name), "--mode", "rpc"],
      {
        cwd: install,
        input: '{"id":"1","type":"get_commands"}\n',
        env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir },
        timeout: 120_000,
      },
    );
    if (smoke.code !== 0 || !rpcAnswered(smoke.stdout)) {
      throw new Error(
        `${label}: the installed tarball does not load in Pi\n${(smoke.stderr || smoke.stdout).trim()}`,
      );
    }

    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    console.log(`verified ${label}: ${tarball} sha256 ${sha256}`);
    return { ...upload, tarball, sha256 };
  } finally {
    run("git", ["worktree", "remove", "--force", worktree], { cwd });
    rmSync(work, { recursive: true, force: true });
  }
}

let uploads;
try {
  uploads = plan.uploads.map(buildUpload);
} catch (error) {
  fail([error instanceof Error ? error.message : String(error)]);
}

const releasePlan = { commit: head, uploads, records: plan.records };
writeFileSync(join(out, "release-plan.json"), `${JSON.stringify(releasePlan, null, 2)}\n`);
const publish = uploads.length > 0 || plan.records.length > 0;

for (const upload of uploads)
  console.log(`upload: ${upload.name}@${upload.version} from ${upload.versionCommit.slice(0, 7)}`);
for (const record of plan.records) {
  const work = [record.needsTag && "tag", record.needsRelease && "release"]
    .filter(Boolean)
    .join(" + ");
  console.log(
    `record: ${record.name}@${record.version} ${work} at ${record.recordCommit.slice(0, 7)}`,
  );
}
console.log(
  publish ? `plan written to ${join(out, "release-plan.json")}` : "nothing to publish or record",
);
if (dryRun) {
  console.log("dry run: nothing was published or recorded");
} else if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}
