import assert from "node:assert/strict";
import { test } from "node:test";

import { runPublish } from "../publish-core.ts";
import { V0, V1, V2, outcomeOf, record, section, world } from "./publish-world.ts";

void test("missing tag: tags the version commit, pushes exactly that ref, and creates the Release", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, true);
  assert.deepEqual(actions, [
    "git tag @indexyz/pi-skill@0.1.44 1",
    "git push @indexyz/pi-skill@0.1.44",
    'gh release create @indexyz/pi-skill@0.1.44 target=1 notes="### Patch Changes\\n\\n- Fix.\\n"',
  ]);
});

void test("tag at an older commit carrying the version: the Release comes from the tag's commit", () => {
  const { ops, actions } = world({
    commits: {
      [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Notes at the tag.") },
      [V2]: { version: "0.1.44", changelog: section("0.1.44", "- Different bytes later.") },
    },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  const result = runPublish(
    { uploads: [], records: [record("@indexyz/pi-skill", "0.1.44", V2)] },
    ops,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(actions, [
    'gh release create @indexyz/pi-skill@0.1.44 target=1 notes="### Patch Changes\\n\\n- Notes at the tag.\\n"',
  ]);
});

void test("tag at a commit without the version fails and is never moved", () => {
  const { ops, actions } = world({
    commits: {
      [V0]: { version: "0.1.40" },
      [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") },
    },
    tags: { "@indexyz/pi-skill@0.1.44": V0 },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /carries 0.1.40; the tag is never moved/u);
  assert.deepEqual(actions, []);
});

void test("Release missing: creates only the Release", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(actions.length, 1);
  assert.match(actions[0] ?? "", /^gh release create @indexyz\/pi-skill@0.1.44 target=1/u);
});

void test("legacy dated heading: a tag and a Release from that section", () => {
  const { ops, actions } = world({
    commits: {
      [V1]: { version: "0.1.43", changelog: "# Changelog\n\n## 0.1.43 - 2026-10-11\n\n- Old.\n" },
    },
    registry: ["@indexyz/pi-skill@0.1.43"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.43")] }, ops);
  assert.equal(result.ok, true);
  assert.deepEqual(actions, [
    "git tag @indexyz/pi-skill@0.1.43 1",
    "git push @indexyz/pi-skill@0.1.43",
    'gh release create @indexyz/pi-skill@0.1.43 target=1 notes="- Old.\\n"',
  ]);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").release, "created");
});

void test("already complete: nothing to do", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
    releases: ["@indexyz/pi-skill@0.1.44"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, true);
  assert.deepEqual(actions, []);
});

void test("a registry lookup failure in the record step is an error, not absence", () => {
  const { ops, actions } = world({ registry: "error" });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /E500/u);
  assert.deepEqual(actions, []);
});

void test("a failed tag push is reported as a tag failure, not a Release failure", () => {
  const { ops } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: ["@indexyz/pi-skill@0.1.44"],
    failingPush: true,
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  const outcome = outcomeOf(result, "@indexyz/pi-skill");
  assert.deepEqual([outcome.tag, outcome.release], ["failed", "unchanged"]);
  assert.match(result.errors[0] ?? "", /git push failed/u);
});
