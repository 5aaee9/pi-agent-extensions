import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { decidePackage, isPublishedPath } from "../gate-core.mjs";
import { createRepo, manifest } from "./helpers.mjs";

const files = ["index.ts", "data/bank.json", "README.md", "CHANGELOG.md", "LICENSE"];
const base = {
  changedPaths: [],
  files,
  baseVersion: "0.1.0",
  headVersion: "0.1.0",
  baseChangelog: "# Changelog\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  headChangelog: "# Changelog\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  touchedIntent: false,
  deletedIntent: false,
};
const prepared = {
  ...base,
  changedPaths: ["package.json", "CHANGELOG.md"],
  headVersion: "0.2.0",
  headChangelog:
    "# Changelog\n\n## 0.2.0\n\n### Minor Changes\n\n- New.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  deletedIntent: true,
};

test("published paths follow the files allowlist plus the always-published files", () => {
  assert.equal(isPublishedPath("index.ts", files), true);
  assert.equal(isPublishedPath("data/bank.json", ["data"]), true);
  assert.equal(isPublishedPath("LICENSE", []), true);
  assert.equal(isPublishedPath("test/a.test.ts", files), false);
  assert.equal(isPublishedPath("openspec/config.yaml", files), false);
  assert.equal(isPublishedPath("index.tsx", files), false);
});

test("a source change without a decision fails", () => {
  const result = decidePackage({ ...base, changedPaths: ["index.ts"] });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.published, ["index.ts"]);
});

test("a stale base intent does not count: only intents touched by the pull request do", () => {
  // The CLI sets touchedIntent only for intents added or modified since the merge base.
  assert.equal(
    decidePackage({ ...base, changedPaths: ["index.ts"], touchedIntent: false }).status,
    "fail",
  );
});

test("a reasoned none intent passes", () => {
  assert.equal(
    decidePackage({ ...base, changedPaths: ["README.md"], touchedIntent: true }).status,
    "pass",
  );
});

test("a release preparation passes without a new intent", () => {
  assert.equal(decidePackage(prepared).status, "pass");
  assert.equal(
    decidePackage({ ...prepared, changedPaths: [...prepared.changedPaths, "README.md"] }).status,
    "pass",
  );
});

test("a preparation carrying a source change needs an intent for it", () => {
  const withSource = { ...prepared, changedPaths: [...prepared.changedPaths, "index.ts"] };
  const result = decidePackage(withSource);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /index\.ts/);
  assert.equal(decidePackage({ ...withSource, touchedIntent: true }).status, "pass");
});

test("tests and OpenSpec changes need no decision", () => {
  assert.equal(
    decidePackage({ ...base, changedPaths: ["test/a.test.ts", "openspec/config.yaml"] }).status,
    "none",
  );
});

test("a version-only change fails", () => {
  const result = decidePackage({ ...base, changedPaths: ["package.json"], headVersion: "0.2.0" });
  assert.equal(result.status, "fail");
  assert.match(result.reason, /without a release preparation/);
  // An intent does not make a bare version change acceptable.
  assert.equal(
    decidePackage({
      ...base,
      changedPaths: ["package.json"],
      headVersion: "0.2.0",
      touchedIntent: true,
    }).status,
    "fail",
  );
});

test("a preparation whose section already existed on the base fails", () => {
  const result = decidePackage({ ...prepared, baseChangelog: prepared.headChangelog });
  assert.equal(result.status, "fail");
});

// End-to-end runs of the CLI against fixture repositories.
const gate = fileURLToPath(new URL("../gate.mjs", import.meta.url));
const repos = [];
after(() => repos.forEach((repo) => repo.cleanup()));

function fixture() {
  const r = createRepo();
  repos.push(r);
  r.write("package.json", { name: "root", private: true, workspaces: ["pi-a", "pi-b"] });
  r.write("pi-a/package.json", manifest("0.1.0"));
  r.write("pi-a/index.ts", "export {};\n");
  r.write("pi-a/CHANGELOG.md", "# Changelog\n\n## 0.1.0 - 2026-01-01\n\n- First.\n");
  r.write("pi-b/package.json", manifest("0.1.0", { name: "@indexyz/pi-b" }));
  r.write("pi-b/index.ts", "export {};\n");
  r.write(".changeset/README.md", "# Intents\n");
  r.commit("initial");
  return r;
}

function runGate(r, baseRef) {
  const result = spawnSync("node", [gate, "--base", baseRef, "--head", "HEAD"], {
    cwd: r.dir,
    encoding: "utf8",
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

const intent = (name, bump, summary = "A summary.") =>
  `---\n"${name}": ${bump}\n---\n\n${summary}\n`;

test("cli: an intent added by the branch passes; a stale one on the base does not", () => {
  const r = fixture();
  r.write(".changeset/old.md", intent("@indexyz/pi-a", "minor"));
  const mainTip = r.commit("pending intent on main");
  r.git("switch", "--quiet", "-c", "feature");
  r.write("pi-a/index.ts", "export const x = 1;\n");
  r.commit("source change");
  const stale = runGate(r, mainTip);
  assert.equal(stale.code, 1, stale.output);
  assert.match(stale.output, /@indexyz\/pi-a: no release decision/);
  assert.match(stale.output, /npm run change -- --patch @indexyz\/pi-a/);
  r.write(".changeset/new.md", intent("@indexyz/pi-a", "patch"));
  r.commit("record decision");
  const ok = runGate(r, mainTip);
  assert.equal(ok.code, 0, ok.output);
});

test("cli: an intent naming two packages fails validation", () => {
  const r = fixture();
  const mainTip = r.git("rev-parse", "HEAD");
  r.write(
    ".changeset/two.md",
    `---\n"@indexyz/pi-a": patch\n"@indexyz/pi-b": patch\n---\n\nBoth.\n`,
  );
  r.commit("two-package intent");
  const result = runGate(r, mainTip);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /names 2 packages/);
});

test("cli: a release preparation that consumed its intent passes", () => {
  const r = fixture();
  r.write(".changeset/feat.md", intent("@indexyz/pi-a", "minor", "New feature."));
  const mainTip = r.commit("intent on main");
  r.git("switch", "--quiet", "-c", "release");
  r.remove(".changeset/feat.md");
  r.write("pi-a/package.json", manifest("0.2.0"));
  r.write(
    "pi-a/CHANGELOG.md",
    "# Changelog\n\n## 0.2.0\n\n### Minor Changes\n\n- New feature.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  );
  r.commit("chore(release): prepare");
  const result = runGate(r, mainTip);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /release preparation for 0\.2\.0/);
});
