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
    'gh release create @indexyz/pi-skill@0.1.44 tag notes="### Patch Changes\\n\\n- Notes at the tag.\\n"',
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

void test("Release missing: creates only the Release, naming no target commitish", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(actions.length, 1);
  assert.match(actions[0] ?? "", /^gh release create @indexyz\/pi-skill@0\.1\.44 tag /u);
});

void test("an existing tag fixes the Release commit, so no target SHA is named", () => {
  // GitHub requires the `workflows` permission for a Release that targets a SHA
  // whose diff to the default branch touches `.github/workflows/**`, which the
  // Actions token cannot have. A version whose tag predates such a change must
  // still be recorded, and the tag already decides the Release's commit.
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.42", changelog: section("0.1.42", "- Old.") } },
    tags: { "@indexyz/pi-skill@0.1.42": V1 },
    registry: ["@indexyz/pi-skill@0.1.42"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.42")] }, ops);
  assert.equal(result.ok, true);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").release, "created");
  assert.deepEqual(actions, [
    'gh release create @indexyz/pi-skill@0.1.42 tag notes="### Patch Changes\\n\\n- Old.\\n"',
  ]);
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
  const { ops, actions, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
    releases: ["@indexyz/pi-skill@0.1.44"],
  });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, true);
  assert.deepEqual(actions, []);
  assert.deepEqual(waits, []);
});

void test("a registry lookup failure in the record step is an error, not absence", () => {
  const { ops, actions, waits } = world({ registry: "error" });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /E500/u);
  assert.deepEqual(actions, []);
  assert.deepEqual(waits, [], "a failing lookup is not waited on");
});

void test("a version the plan confirmed but the registry no longer shows is waited for and then fails", () => {
  const { ops, actions, waits } = world({ registry: [] });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").tag, "unchanged");
  assert.match(
    result.errors[0] ?? "",
    /pi-skill@0\.1\.44: not visible on the registry after 30 minutes of waiting; rerun the workflow to record it/u,
  );
  assert.equal(
    waits.reduce((sum, value) => sum + value, 0),
    1_800_000,
  );
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
