import assert from "node:assert/strict";
import { test } from "node:test";

import { runPublish } from "../publish-core.mjs";

const V1 = "1111111111111111111111111111111111111111";
const V2 = "2222222222222222222222222222222222222222";
const V0 = "0000000000000000000000000000000000000000";
const section = (version, line) =>
  `# Changelog\n\n## ${version}\n\n### Patch Changes\n\n${line}\n\n## 0.1.43 - 2026-10-11\n\n- Old.\n`;

/**
 * Command doubles recording every side effect in `actions`. `commits` maps a
 * commit to `{ version, changelog }`; `registry` lists published versions.
 */
function world({
  commits = {},
  tags = {},
  registry = [],
  releases = [],
  publish = {},
  hashes = {},
}) {
  const actions = [];
  const ops = {
    sha256: (tarball) => hashes[tarball] ?? "good",
    npmPublish: (tarball) => {
      actions.push(`npm publish ${tarball}`);
      const outcome = publish[tarball] ?? { ok: true };
      if (outcome.ok && outcome.adds) registry.push(outcome.adds);
      return { ok: outcome.ok, output: outcome.output ?? "" };
    },
    registryHas: (name, version) => {
      if (registry === "error") throw new Error("npm view failed (exit 1) E500");
      return registry.includes(`${name}@${version}`);
    },
    tagCommit: (tag) => tags[tag] ?? null,
    manifestVersionAt: (commit) => commits[commit]?.version ?? null,
    createTag: (tag, commit) => {
      actions.push(`git tag ${tag} ${commit.slice(0, 1)}`);
      tags[tag] = commit;
    },
    pushTag: (tag) => actions.push(`git push ${tag}`),
    changelogAt: (commit) => commits[commit]?.changelog ?? null,
    releaseExists: (tag) => releases.includes(tag),
    createRelease: ({ tag, target, notes }) =>
      actions.push(
        `gh release create ${tag} target=${target.slice(0, 1)} notes=${JSON.stringify(notes)}`,
      ),
    log: () => {},
  };
  return { ops, actions };
}

const record = (name, version, versionCommit = V1) => ({
  name,
  dir: name.slice(9),
  version,
  versionCommit,
  recordCommit: versionCommit,
});
const upload = (name, version, versionCommit = V1) => ({
  name,
  dir: name.slice(9),
  version,
  versionCommit,
  tarball: `${name.slice(9)}.tgz`,
  sha256: "good",
});

test("missing tag: tags the version commit, pushes exactly that ref, and creates the Release", () => {
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

test("tag at an older commit carrying the version: the Release comes from the tag's commit", () => {
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

test("tag at a commit without the version fails and is never moved", () => {
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
  assert.match(result.errors[0], /carries 0.1.40; the tag is never moved/);
  assert.deepEqual(actions, []);
});

test("Release missing: creates only the Release", () => {
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    tags: { "@indexyz/pi-skill@0.1.44": V1 },
    registry: ["@indexyz/pi-skill@0.1.44"],
  });
  runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(actions.length, 1);
  assert.match(actions[0], /^gh release create @indexyz\/pi-skill@0.1.44 target=1/);
});

test("legacy dated heading: a tag and no Release", () => {
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
  ]);
  assert.equal(result.outcomes.get("@indexyz/pi-skill").release, "none (no exact section)");
});

test("already complete: nothing to do", () => {
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

test("already published during upload: counted as published and recorded", () => {
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
  assert.equal(result.outcomes.get("@indexyz/pi-skill").upload, "already published");
  assert.deepEqual(actions.slice(0, 3), [
    "npm publish pi-skill.tgz",
    "git tag @indexyz/pi-skill@0.1.44 1",
    "git push @indexyz/pi-skill@0.1.44",
  ]);
});

test("second upload fails after the first succeeded: the first is recorded, later uploads are not attempted", () => {
  const registry = [];
  const { ops, actions } = world({
    commits: { [V1]: { version: "0.1.44", changelog: section("0.1.44", "- Fix.") } },
    registry,
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
  assert.deepEqual(
    [...result.outcomes].map(([name, o]) => `${name} ${o.upload} ${o.tag}`),
    [
      "@indexyz/pi-skill published created",
      "@indexyz/pi-continue failed unchanged",
      "@indexyz/pi-autocompact not attempted unchanged",
    ],
  );
  assert.deepEqual(
    actions.filter((a) => a.startsWith("npm publish")),
    ["npm publish pi-skill.tgz", "npm publish pi-continue.tgz"],
  );
  assert.ok(actions.includes("git tag @indexyz/pi-skill@0.1.44 1"));
  assert.ok(!actions.some((a) => a.includes("pi-continue@") || a.includes("pi-autocompact@")));
  assert.match(result.errors[0], /pi-continue@0.1.44: npm publish failed/);
});

test("a tarball whose hash differs from the plan stops everything before upload", () => {
  const { ops, actions } = world({ hashes: { "pi-skill.tgz": "tampered" } });
  const result = runPublish({ uploads: [upload("@indexyz/pi-skill", "0.1.44")], records: [] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /SHA-256 does not match/);
  assert.deepEqual(actions, []);
});

test("a registry lookup failure in the record step is an error, not absence", () => {
  const { ops, actions } = world({ registry: "error" });
  const result = runPublish({ uploads: [], records: [record("@indexyz/pi-skill", "0.1.44")] }, ops);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /E500/);
  assert.deepEqual(actions, []);
});
