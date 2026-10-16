import assert from "node:assert/strict";
import { test } from "node:test";

import { runPublish } from "../publish-core.ts";
import { V1, outcomeOf, record, section, summary, upload, world } from "./publish-world.ts";

void test("already published during upload: counted as published and recorded", () => {
  const registry = ["@indexyz/pi-skill@0.1.44"];
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry,
    publish: {
      "pi-skill.tgz": {
        ok: false,
        output: "npm error 403 You cannot publish over the previously published versions: 0.1.44.",
      },
    },
  });
  const plan = {
    uploads: [upload("@indexyz/pi-skill", "0.1.44")],
    records: [record("@indexyz/pi-skill", "0.1.44")],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, true);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").upload, "already published");
  assert.deepEqual(actions.slice(0, 3), [
    "npm publish pi-skill.tgz",
    "git tag @indexyz/pi-skill@0.1.44 1",
    "git push @indexyz/pi-skill@0.1.44",
  ]);
});

void test("second upload fails after the first succeeded: the first is recorded, later uploads are not attempted", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": { ok: true, adds: "@indexyz/pi-skill@0.1.44" },
      "pi-continue.tgz": { ok: false, output: "npm error 500 Internal Server Error" },
    },
  });
  const plan = {
    uploads: [
      upload("@indexyz/pi-skill", "0.1.44"),
      upload("@indexyz/pi-continue", "0.1.44"),
      upload("@indexyz/pi-autocompact", "0.1.44"),
    ],
    records: [
      record("@indexyz/pi-skill", "0.1.44"),
      record("@indexyz/pi-continue", "0.1.44"),
      record("@indexyz/pi-autocompact", "0.1.44"),
    ],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, false);
  assert.deepEqual(summary(result), [
    "@indexyz/pi-skill published created",
    "@indexyz/pi-continue failed unchanged",
    "@indexyz/pi-autocompact not attempted unchanged",
  ]);
  assert.deepEqual(
    actions.filter((a) => a.startsWith("npm publish")),
    ["npm publish pi-skill.tgz", "npm publish pi-continue.tgz"],
  );
  assert.ok(actions.includes("git tag @indexyz/pi-skill@0.1.44 1"));
  assert.ok(!actions.some((a) => a.includes("pi-continue@") || a.includes("pi-autocompact@")));
  assert.match(result.errors[0] ?? "", /pi-continue@0.1.44: npm publish failed/u);
});

void test("a tarball whose hash differs from the plan stops everything before upload", () => {
  const { ops, actions } = world({ hashes: { "pi-skill.tgz": "tampered" } });
  const result = runPublish({ uploads: [upload("@indexyz/pi-skill", "0.1.44")], records: [] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /SHA-256 does not match/u);
  assert.deepEqual(actions, []);
});

void test("a failed registry re-check after an already-published error fails that upload but still records earlier uploads", () => {
  const { ops, actions, views } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    failingViews: ["@indexyz/pi-continue@0.1.44"],
    publish: {
      "pi-skill.tgz": { ok: true, adds: "@indexyz/pi-skill@0.1.44" },
      "pi-continue.tgz": {
        ok: false,
        output: "npm error 403 You cannot publish over the previously published versions: 0.1.44.",
      },
    },
  });
  const plan = {
    uploads: [
      upload("@indexyz/pi-skill", "0.1.44"),
      upload("@indexyz/pi-continue", "0.1.44"),
      upload("@indexyz/pi-autocompact", "0.1.44"),
    ],
    records: [
      record("@indexyz/pi-skill", "0.1.44"),
      record("@indexyz/pi-continue", "0.1.44"),
      record("@indexyz/pi-autocompact", "0.1.44"),
    ],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, false);
  assert.deepEqual(summary(result), [
    "@indexyz/pi-skill published created",
    "@indexyz/pi-continue failed unchanged",
    "@indexyz/pi-autocompact not attempted unchanged",
  ]);
  assert.ok(
    views.includes("@indexyz/pi-skill@0.1.44"),
    "the earlier upload is confirmed and recorded",
  );
  assert.ok(actions.includes("git tag @indexyz/pi-skill@0.1.44 1"));
  assert.match(
    result.errors[0] ?? "",
    /pi-continue@0.1.44: npm publish failed[\s\S]*registry re-check failed: npm view failed/u,
  );
});

void test("an upload that succeeded but is not visible on the registry yet fails the run without recording", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: { "pi-skill.tgz": { ok: true } },
  });
  const plan = {
    uploads: [upload("@indexyz/pi-skill", "0.1.44")],
    records: [record("@indexyz/pi-skill", "0.1.44")],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, false);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").upload, "published");
  assert.match(result.errors[0] ?? "", /pi-skill@0.1.44: not visible on the registry yet/u);
  assert.deepEqual(actions, ["npm publish pi-skill.tgz"]);
});
