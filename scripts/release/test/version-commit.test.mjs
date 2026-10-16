import assert from "node:assert/strict";
import { after, test } from "node:test";

import { findVersionCommit } from "../version-commit.mjs";
import { createRepo, manifest } from "./helpers.mjs";

const repos = [];
after(() => repos.forEach((repo) => repo.cleanup()));

function repo() {
  const created = createRepo();
  repos.push(created);
  created.write("README.md", "root\n");
  created.commit("root");
  return created;
}

const lookup = (r, version, head = "HEAD") =>
  findVersionCommit({ cwd: r.dir, head, dir: "pi-a", version });

test("linear history: the commit that set the version", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.1.0"));
  const first = r.commit("add package");
  r.write("pi-a/index.ts", "export {};\n");
  r.commit("source change");
  assert.equal(lookup(r, "0.1.0"), first);
  r.write("pi-a/package.json", manifest("0.1.1"));
  const bump = r.commit("bump");
  r.write("pi-a/index.ts", "export const x = 1;\n");
  r.commit("later change");
  assert.equal(lookup(r, "0.1.1"), bump);
});

test("a commit that only reformats the manifest is not a candidate", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.2.0"));
  const bump = r.commit("bump");
  r.write("pi-a/package.json", `${JSON.stringify(manifest("0.2.0"))}\n`);
  r.commit("reformat");
  r.write("pi-a/package.json", manifest("0.2.0", { description: "changed" }));
  r.commit("edit another field");
  assert.equal(lookup(r, "0.2.0"), bump);
});

test("a replaced version resolves the current one", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.2.0"));
  r.commit("prepare 0.2.0");
  r.write("pi-a/package.json", manifest("0.3.0"));
  const replaced = r.commit("prepare 0.3.0");
  assert.equal(lookup(r, "0.3.0"), replaced);
  r.write("pi-a/package.json", manifest("0.2.0"));
  const revert = r.commit("revert to 0.2.0");
  assert.equal(lookup(r, "0.2.0"), revert);
});

test("a squash commit is the version commit", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.1.0"));
  r.commit("add package");
  r.git("switch", "--quiet", "-c", "release");
  r.write("pi-a/package.json", manifest("0.1.1"));
  r.commit("bump on branch");
  r.git("switch", "--quiet", "main");
  r.git("merge", "--quiet", "--squash", "release");
  const squash = r.commit("squash release");
  assert.equal(lookup(r, "0.1.1"), squash);
});

test("a merge commit is the version commit on the first-parent history", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.1.0"));
  r.commit("add package");
  r.git("switch", "--quiet", "-c", "release");
  r.write("pi-a/package.json", manifest("0.1.1"));
  const sideCommit = r.commit("bump on branch");
  r.git("switch", "--quiet", "main");
  r.write("other.txt", "x\n");
  r.commit("unrelated on main");
  r.git("merge", "--quiet", "--no-ff", "-m", "merge release", "release");
  const merge = r.git("rev-parse", "HEAD");
  assert.notEqual(merge, sideCommit);
  assert.equal(lookup(r, "0.1.1"), merge);
});

test("returns null when no commit carries the version", () => {
  const r = repo();
  r.write("pi-a/package.json", manifest("0.1.0"));
  r.commit("add package");
  assert.equal(lookup(r, "9.9.9"), null);
});
