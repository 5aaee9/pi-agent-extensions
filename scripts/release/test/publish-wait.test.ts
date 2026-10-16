import assert from "node:assert/strict";
import { test } from "node:test";

import { runPublish } from "../publish-core.ts";
import { V1, outcomeOf, record, section, summary, upload, world } from "./publish-world.ts";

const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);
const ALREADY = "npm error 403 You cannot publish over the previously published versions: 0.1.44.";

void test("an upload that succeeded but is not visible yet is waited for and then recorded", () => {
  const { ops, actions, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": {
        ok: true,
        adds: "@indexyz/pi-skill@0.1.44",
        visibleAfter: 15_000,
      },
    },
  });
  const plan = {
    uploads: [upload("@indexyz/pi-skill", "0.1.44")],
    records: [record("@indexyz/pi-skill", "0.1.44")],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, true);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").upload, "published");
  assert.deepEqual(waits, [5_000, 10_000]);
  assert.deepEqual(actions, [
    "npm publish pi-skill.tgz",
    "git tag @indexyz/pi-skill@0.1.44 1",
    "git push @indexyz/pi-skill@0.1.44",
    'gh release create @indexyz/pi-skill@0.1.44 target=1 notes="### Patch Changes\\n\\n- Fix.\\n"',
  ]);
});

void test("the wait doubles its interval and caps it at two minutes", () => {
  const { ops, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": {
        ok: true,
        adds: "@indexyz/pi-skill@0.1.44",
        visibleAfter: 300_000,
      },
    },
  });
  const result = runPublish(
    {
      uploads: [upload("@indexyz/pi-skill", "0.1.44")],
      records: [record("@indexyz/pi-skill", "0.1.44")],
    },
    ops,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
  assert.equal(total(waits), 395_000, "the version appears on the seventh lookup");
});

void test("a version that never appears fails after the 30-minute budget without being recorded", () => {
  const { ops, actions, views, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: { "pi-skill.tgz": { ok: true } },
  });
  const result = runPublish(
    {
      uploads: [upload("@indexyz/pi-skill", "0.1.44")],
      records: [record("@indexyz/pi-skill", "0.1.44")],
    },
    ops,
  );
  assert.equal(result.ok, false);
  assert.equal(outcomeOf(result, "@indexyz/pi-skill").upload, "published");
  assert.match(
    result.errors[0] ?? "",
    /pi-skill@0\.1\.44: not visible on the registry after 30 minutes of waiting; rerun the workflow to record it/u,
  );
  assert.deepEqual(waits.slice(0, 5), [5_000, 10_000, 20_000, 40_000, 80_000]);
  assert.equal(Math.max(...waits), 120_000, "the interval never exceeds the cap");
  assert.equal(total(waits), 1_800_000, "the run waits exactly the budget, never more");
  assert.equal(
    views.length,
    waits.length + 1,
    "one lookup before each wait and the last at the deadline",
  );
  assert.deepEqual(actions, ["npm publish pi-skill.tgz"]);
});

void test("the budget is shared by the run: a later version gets only what is left", () => {
  const { ops, views, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: { "pi-skill.tgz": { ok: true }, "pi-continue.tgz": { ok: true } },
  });
  const result = runPublish(
    {
      uploads: [upload("@indexyz/pi-skill", "0.1.44"), upload("@indexyz/pi-continue", "0.1.44")],
      records: [record("@indexyz/pi-skill", "0.1.44"), record("@indexyz/pi-continue", "0.1.44")],
    },
    ops,
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.equal(total(waits), 1_800_000, "the first version spends the whole budget");
  assert.equal(
    views.filter((view) => view === "@indexyz/pi-continue@0.1.44").length,
    1,
    "the later version is looked up once and not waited for again",
  );
  assert.match(result.errors[1] ?? "", /pi-continue@0\.1\.44: not visible/u);
});

void test("npm reports the version already published but invisible: waited for, recorded, and later uploads continue", () => {
  const { ops, actions, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": {
        ok: false,
        output: ALREADY,
        adds: "@indexyz/pi-skill@0.1.44",
        visibleAfter: 10_000,
      },
      "pi-continue.tgz": { ok: true, adds: "@indexyz/pi-continue@0.1.44" },
    },
  });
  const plan = {
    uploads: [upload("@indexyz/pi-skill", "0.1.44"), upload("@indexyz/pi-continue", "0.1.44")],
    records: [record("@indexyz/pi-skill", "0.1.44"), record("@indexyz/pi-continue", "0.1.44")],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, true);
  assert.deepEqual(summary(result), [
    "@indexyz/pi-skill already published created",
    "@indexyz/pi-continue published created",
  ]);
  assert.deepEqual(waits, [5_000, 10_000]);
  assert.deepEqual(
    actions.filter((a) => a.startsWith("npm publish")),
    ["npm publish pi-skill.tgz", "npm publish pi-continue.tgz"],
    "the wait does not stop later uploads",
  );
});

void test("an already-published version still invisible after the budget fails its upload", () => {
  const { ops, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": { ok: false, output: ALREADY },
      "pi-continue.tgz": { ok: true },
    },
  });
  const plan = {
    uploads: [upload("@indexyz/pi-skill", "0.1.44"), upload("@indexyz/pi-continue", "0.1.44")],
    records: [record("@indexyz/pi-skill", "0.1.44"), record("@indexyz/pi-continue", "0.1.44")],
  };
  const result = runPublish(plan, ops);
  assert.equal(result.ok, false);
  assert.deepEqual(summary(result), [
    "@indexyz/pi-skill failed unchanged",
    "@indexyz/pi-continue not attempted unchanged",
  ]);
  assert.match(
    result.errors[0] ?? "",
    /pi-skill@0\.1\.44: npm publish reports the version already published, but the registry still does not show it after 30 minutes; rerun the workflow to record it/u,
  );
  assert.equal(total(waits), 1_800_000);
});

void test("a version that appears during the last wait of the budget is still recorded", () => {
  const { ops, actions, waits } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry: [],
    publish: {
      "pi-skill.tgz": {
        ok: true,
        adds: "@indexyz/pi-skill@0.1.44",
        visibleAfter: 1_800_000,
      },
    },
  });
  const result = runPublish(
    {
      uploads: [upload("@indexyz/pi-skill", "0.1.44")],
      records: [record("@indexyz/pi-skill", "0.1.44")],
    },
    ops,
  );
  assert.equal(result.ok, true, "the last lookup at the deadline still counts");
  assert.equal(total(waits), 1_800_000);
  assert.ok(actions.includes("git tag @indexyz/pi-skill@0.1.44 1"));
  assert.ok(actions.some((action) => action.startsWith("gh release create")));
});
