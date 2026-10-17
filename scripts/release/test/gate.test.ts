import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { decidePackage, type GateInput, isPublishedPath } from "../gate-core.ts";
import { createRepo, type FixtureRepo, manifest } from "./helpers.ts";

const files = ["index.ts", "data/bank.json", "README.md", "CHANGELOG.md", "LICENSE"];
const base: GateInput = {
  dsh: false,
  changedPaths: [],
  files,
  baseVersion: "0.1.0",
  headVersion: "0.1.0",
  baseChangelog: "# Changelog\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  headChangelog: "# Changelog\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  touchedIntent: false,
  consumedIntent: false,
};
const prepared: GateInput = {
  ...base,
  changedPaths: ["package.json", "CHANGELOG.md"],
  headVersion: "0.2.0",
  headChangelog:
    "# Changelog\n\n## 0.2.0\n\n### Minor Changes\n\n- New.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  consumedIntent: true,
};

void test("published paths follow the files allowlist plus the always-published files", () => {
  assert.equal(isPublishedPath("index.ts", files), true);
  assert.equal(isPublishedPath("data/bank.json", ["data"]), true);
  assert.equal(isPublishedPath("LICENSE", []), true);
  assert.equal(isPublishedPath("test/a.test.ts", files), false);
  assert.equal(isPublishedPath("openspec/config.yaml", files), false);
  assert.equal(isPublishedPath("index.tsx", files), false);
});

void test("a source change without a decision fails", () => {
  const result = decidePackage({ ...base, changedPaths: ["index.ts"] });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.published, ["index.ts"]);
});

void test("a stale base intent does not count: only intents touched by the pull request do", () => {
  // The CLI sets touchedIntent only for intents added or modified since the merge base.
  assert.equal(
    decidePackage({ ...base, changedPaths: ["index.ts"], touchedIntent: false }).status,
    "fail",
  );
});

void test("a reasoned none intent passes", () => {
  assert.equal(
    decidePackage({ ...base, changedPaths: ["README.md"], touchedIntent: true }).status,
    "pass",
  );
});

void test("a release preparation passes without a new intent", () => {
  assert.equal(decidePackage(prepared).status, "pass");
  assert.equal(
    decidePackage({ ...prepared, changedPaths: [...prepared.changedPaths, "README.md"] }).status,
    "pass",
  );
});

void test("a preparation carrying a source change needs an intent for it", () => {
  const withSource = { ...prepared, changedPaths: [...prepared.changedPaths, "index.ts"] };
  const result = decidePackage(withSource);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /index\.ts/u);
  assert.equal(decidePackage({ ...withSource, touchedIntent: true }).status, "pass");
});

void test("tests and OpenSpec changes need no decision", () => {
  assert.equal(
    decidePackage({ ...base, changedPaths: ["test/a.test.ts", "openspec/config.yaml"] }).status,
    "none",
  );
});

void test("a version-only change fails", () => {
  const result = decidePackage({ ...base, changedPaths: ["package.json"], headVersion: "0.2.0" });
  assert.equal(result.status, "fail");
  assert.match(result.reason, /without a release preparation/u);
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

void test("a preparation whose section already existed on the base fails", () => {
  const result = decidePackage({ ...prepared, baseChangelog: prepared.headChangelog });
  assert.equal(result.status, "fail");
});

const dsh: GateInput = { ...base, dsh: true, files: ["lib", "client.js", "cordis.patch.yml"] };

void test("dsh runtime sources and build configurations need a release decision", () => {
  for (const path of [
    "index.ts",
    "settings.ts",
    "view.tsx",
    "src/client/index.tsx",
    "src/client/styles.css",
    "tsconfig.json",
    "tsconfig.build.json",
    "tsdown.config.ts",
  ]) {
    const input = { ...dsh, changedPaths: [path] };
    const result = decidePackage(input);
    assert.equal(result.status, "fail", path);
    assert.deepEqual(result.published, [path]);
    assert.equal(decidePackage({ ...input, touchedIntent: true }).status, "pass", path);
  }
});

void test("unpublished dsh development files do not need a decision", () => {
  assert.equal(
    decidePackage({
      ...dsh,
      changedPaths: [
        "test/index.test.ts",
        "test/smoke-release.ts",
        "index.test.ts",
        "view.spec.tsx",
        "vitest.config.ts",
        "openspec/config.yaml",
        "openspec/changes/example/tasks.md",
      ],
    }).status,
    "none",
  );
  assert.equal(
    decidePackage({ ...dsh, files: ["vitest.config.ts"], changedPaths: ["vitest.config.ts"] })
      .status,
    "fail",
  );
});

void test("Pi packages still classify only directly published paths", () => {
  assert.equal(
    decidePackage({
      ...base,
      changedPaths: ["helper.ts", "src/client/index.tsx", "tsconfig.json", "tsdown.config.ts"],
    }).status,
    "none",
  );
});

void test("dsh release preparations also require decisions for unpublished build inputs", () => {
  for (const path of ["index.ts", "tsconfig.build.json"]) {
    const input = {
      ...prepared,
      dsh: true,
      files: dsh.files,
      changedPaths: [...prepared.changedPaths, path],
    };
    assert.equal(decidePackage(input).status, "fail", path);
    assert.equal(decidePackage({ ...input, touchedIntent: true }).status, "pass", path);
  }
});

// End-to-end runs of the CLI against fixture repositories.
const gate = fileURLToPath(new URL("../gate.ts", import.meta.url));
const repos: FixtureRepo[] = [];
after(() => {
  for (const repo of repos) {
    repo.cleanup();
  }
});

function fixture(): FixtureRepo {
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

function runGate(r: FixtureRepo, baseRef: string): { code: number | null; output: string } {
  const result = spawnSync("node", [gate, "--base", baseRef, "--head", "HEAD"], {
    cwd: r.dir,
    encoding: "utf8",
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

const intent = (name: string, bump: string, summary = "A summary."): string =>
  `---\n"${name}": ${bump}\n---\n\n${summary}\n`;

void test("cli: an intent added by the branch passes; a stale one on the base does not", () => {
  const r = fixture();
  r.write(".changeset/old.md", intent("@indexyz/pi-a", "minor"));
  const mainTip = r.commit("pending intent on main");
  r.git("switch", "--quiet", "-c", "feature");
  r.write("pi-a/index.ts", "export const x = 1;\n");
  r.commit("source change");
  const stale = runGate(r, mainTip);
  assert.equal(stale.code, 1, stale.output);
  assert.match(stale.output, /@indexyz\/pi-a: no release decision/u);
  assert.match(stale.output, /npm run change -- --patch @indexyz\/pi-a/u);
  r.write(".changeset/new.md", intent("@indexyz/pi-a", "patch"));
  r.commit("record decision");
  const ok = runGate(r, mainTip);
  assert.equal(ok.code, 0, ok.output);
});

void test("cli: a dsh source-only change fails until the branch records a decision", () => {
  const r = createRepo();
  repos.push(r);
  r.write("package.json", { name: "root", private: true, workspaces: ["dsh-a"] });
  r.write("dsh-a/package.json", {
    ...manifest("0.1.0", { name: "@indexyz/dsh-a", files: ["lib"] }),
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
  });
  r.write(".gitignore", "/dsh-a/lib/\n");
  r.write("dsh-a/index.ts", "export const value = 1;\n");
  const mainTip = r.commit("dsh sources without tracked output");
  r.write("dsh-a/index.ts", "export const value = 2;\n");
  r.commit("change only an unpublished source");
  const missing = runGate(r, mainTip);
  assert.equal(missing.code, 1, missing.output);
  assert.match(missing.output, /dsh-a\/index\.ts/u);
  r.write(".changeset/dsh.md", intent("@indexyz/dsh-a", "none", "No runtime release needed."));
  r.commit("record explicit release decision");
  const decided = runGate(r, mainTip);
  assert.equal(decided.code, 0, decided.output);
});

void test("cli: an intent naming two packages fails validation", () => {
  const r = fixture();
  const mainTip = r.git("rev-parse", "HEAD");
  r.write(
    ".changeset/two.md",
    `---\n"@indexyz/pi-a": patch\n"@indexyz/pi-b": patch\n---\n\nBoth.\n`,
  );
  r.commit("two-package intent");
  const result = runGate(r, mainTip);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /names 2 packages/u);
});

void test("cli: a release preparation that consumed its intent passes", () => {
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
  assert.match(result.output, /release preparation for 0\.2\.0/u);
});

void test("cli: a version bump that deletes only a none intent is not a preparation", () => {
  const r = fixture();
  r.write(".changeset/docs.md", intent("@indexyz/pi-a", "none", "README only."));
  const mainTip = r.commit("none intent on main");
  r.git("switch", "--quiet", "-c", "hand-bump");
  r.remove(".changeset/docs.md");
  r.write("pi-a/package.json", manifest("0.2.0"));
  r.write(
    "pi-a/CHANGELOG.md",
    "# Changelog\n\n## 0.2.0\n\n### Minor Changes\n\n- Unapproved.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n",
  );
  r.commit("hand-edited version");
  const result = runGate(r, mainTip);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /consumed \(deleted\) patch, minor, or major intent/u);
});
