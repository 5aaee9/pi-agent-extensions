import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inspectTarball,
  parsePackOutput,
  planPackage,
  planPackages,
  rpcAnswered,
} from "../plan-core.mjs";

const V1 = "1111111111111111111111111111111111111111";
const V2 = "2222222222222222222222222222222222222222";
const dated = "# Changelog\n\n## 0.1.43 - 2026-10-11\n\n- Old.\n";
const exact = (version, line = "- Fix.") =>
  `# Changelog\n\n## ${version}\n\n### Patch Changes\n\n${line}\n\n${dated.slice(13)}`;

/**
 * Command doubles: `commits` maps a commit to `{ version, changelog }` for the
 * package; `tags`, `registry`, and `releases` describe remote state.
 */
function ops({ versionCommit = V1, commits, tags = {}, registry = [], releases = [], calls = [] }) {
  return {
    versionCommit: () => versionCommit,
    registryHas: (name, version) => {
      calls.push(`npm view ${name}@${version}`);
      return registry.includes(`${name}@${version}`);
    },
    tagCommit: (tag) => tags[tag] ?? null,
    manifestVersionAt: (commit) => commits[commit]?.version ?? null,
    changelogAt: (commit) => commits[commit]?.changelog ?? null,
    releaseState: (tag) => {
      calls.push(`gh release view ${tag}`);
      return releases.includes(tag) ? "present" : "missing";
    },
  };
}

const pkg = (version) => ({ name: "@indexyz/pi-skill", dir: "pi-skill", version });

test("an absent version with an exact section is an upload and needs its tag and Release", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({ commits: { [V1]: { version: "0.1.44", changelog: exact("0.1.44") } } }),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.upload, {
    name: "@indexyz/pi-skill",
    dir: "pi-skill",
    version: "0.1.44",
    versionCommit: V1,
  });
  assert.deepEqual(result.record, {
    name: "@indexyz/pi-skill",
    dir: "pi-skill",
    version: "0.1.44",
    versionCommit: V1,
    recordCommit: V1,
    needsTag: true,
    needsRelease: true,
  });
});

test("an absent version without an exact section fails", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({ commits: { [V1]: { version: "0.1.44", changelog: dated } } }),
  );
  assert.match(result.errors[0], /no "## 0.1.44" section/);
  assert.equal(result.upload, null);
});

test("an absent version with a duplicate section fails", () => {
  const twice = `${exact("0.1.44")}\n## 0.1.44\n\n- Again.\n`;
  const result = planPackage(
    pkg("0.1.44"),
    ops({ commits: { [V1]: { version: "0.1.44", changelog: twice } } }),
  );
  assert.match(result.errors[0], /2 "## 0.1.44" sections/);
});

test("0.1.43 untagged with a dated heading is tag work only", () => {
  const calls = [];
  const result = planPackage(
    pkg("0.1.43"),
    ops({
      commits: { [V1]: { version: "0.1.43", changelog: dated } },
      registry: ["@indexyz/pi-skill@0.1.43"],
      calls,
    }),
  );
  assert.equal(result.upload, null);
  assert.equal(result.record.needsTag, true);
  assert.equal(result.record.needsRelease, false);
  assert.match(result.notices[0], /tag and no Release/);
  assert.ok(!calls.some((call) => call.startsWith("gh")), "no Release lookup without a section");
});

test("0.1.43 tagged with a dated heading and no Release is no work", () => {
  const result = planPackage(
    pkg("0.1.43"),
    ops({
      commits: { [V1]: { version: "0.1.43", changelog: dated } },
      registry: ["@indexyz/pi-skill@0.1.43"],
      tags: { "@indexyz/pi-skill@0.1.43": V1 },
    }),
  );
  assert.deepEqual(result, { errors: [], notices: [], upload: null, record: null });
});

test("a second plan after the tags exist is empty", () => {
  const names = ["pi-skill", "pi-continue"];
  const packages = names.map((dir) => ({ name: `@indexyz/${dir}`, dir, version: "0.1.43" }));
  const plan = planPackages(
    packages,
    ops({
      commits: { [V1]: { version: "0.1.43", changelog: dated } },
      registry: packages.map((p) => `${p.name}@0.1.43`),
      tags: Object.fromEntries(packages.map((p) => [`${p.name}@0.1.43`, V1])),
    }),
  );
  assert.deepEqual(plan, { errors: [], notices: [], uploads: [], records: [] });
});

test("a published, tagged version with a section and no Release is Release work", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({
      commits: { [V1]: { version: "0.1.44", changelog: exact("0.1.44") } },
      registry: ["@indexyz/pi-skill@0.1.44"],
      tags: { "@indexyz/pi-skill@0.1.44": V1 },
    }),
  );
  assert.deepEqual(
    {
      needsTag: result.record.needsTag,
      needsRelease: result.record.needsRelease,
      recordCommit: result.record.recordCommit,
    },
    { needsTag: false, needsRelease: true, recordCommit: V1 },
  );
});

test("a complete version is no work", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({
      commits: { [V1]: { version: "0.1.44", changelog: exact("0.1.44") } },
      registry: ["@indexyz/pi-skill@0.1.44"],
      tags: { "@indexyz/pi-skill@0.1.44": V1 },
      releases: ["@indexyz/pi-skill@0.1.44"],
    }),
  );
  assert.equal(result.record, null);
});

test("a tag at another commit carrying the version is accepted and is the record commit", () => {
  // V2 is the newer version commit (a revert); the tag points at the older V1.
  const result = planPackage(
    pkg("0.1.44"),
    ops({
      versionCommit: V2,
      commits: {
        [V1]: { version: "0.1.44", changelog: exact("0.1.44", "- Notes at the tag.") },
        [V2]: { version: "0.1.44", changelog: exact("0.1.44", "- Different bytes later.") },
      },
      registry: ["@indexyz/pi-skill@0.1.44"],
      tags: { "@indexyz/pi-skill@0.1.44": V1 },
    }),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.record.recordCommit, V1);
  assert.equal(result.record.versionCommit, V2);
  assert.equal(result.record.needsTag, false);
});

test("a tag at a commit not carrying the version fails", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({
      commits: {
        [V1]: { version: "0.1.44", changelog: exact("0.1.44") },
        [V2]: { version: "0.1.40" },
      },
      registry: ["@indexyz/pi-skill@0.1.44"],
      tags: { "@indexyz/pi-skill@0.1.44": V2 },
    }),
  );
  assert.match(result.errors[0], /carries 0.1.40; the tag is never moved/);
});

test("a registry lookup failure is not absence", () => {
  const failing = {
    ...ops({ commits: {} }),
    registryHas: () => {
      throw new Error("npm view failed (exit 1) E401");
    },
  };
  assert.throws(() => planPackage(pkg("0.1.44"), failing), /E401/);
});

const manifest = {
  files: ["index.ts", "data/bank.json", "README.md", "CHANGELOG.md", "LICENSE"],
  pi: { extensions: ["./index.ts"] },
};
const good = ["package.json", "README.md", "CHANGELOG.md", "LICENSE", "index.ts", "data/bank.json"];
const inspect = (entries, packed = { name: "@indexyz/pi-a", version: "1.0.0" }) =>
  inspectTarball({ name: "@indexyz/pi-a", version: "1.0.0", manifest, entries, packed });

test("tarball inspection accepts a complete package", () => {
  assert.deepEqual(inspect(good), []);
});

test("tarball inspection reports missing resources, tests, OpenSpec files, and a wrong manifest", () => {
  assert.deepEqual(inspect(good.filter((entry) => entry !== "data/bank.json")), [
    'missing "files" entry data/bank.json',
  ]);
  assert.deepEqual(inspect(good.filter((entry) => entry !== "LICENSE")), [
    "missing LICENSE",
    'missing "files" entry LICENSE',
  ]);
  assert.deepEqual(inspect([...good, "test/a.test.ts", "openspec/config.yaml"]), [
    "unexpected test/a.test.ts",
    "unexpected openspec/config.yaml",
  ]);
  assert.deepEqual(inspect(good, { name: "@indexyz/pi-a", version: "0.9.0" }), [
    "packed manifest is @indexyz/pi-a@0.9.0, expected @indexyz/pi-a@1.0.0",
  ]);
  const noExtension = inspectTarball({
    name: "@indexyz/pi-a",
    version: "1.0.0",
    manifest: { files: ["README.md"], pi: { extensions: ["./index.ts"] } },
    entries: ["package.json", "README.md", "CHANGELOG.md", "LICENSE"],
    packed: { name: "@indexyz/pi-a", version: "1.0.0" },
  });
  assert.deepEqual(noExtension, ["missing Pi resource index.ts"]);
});

test("npm pack output is parsed after lifecycle script output", () => {
  const stdout =
    '\n> prepack\n> vitest run\n\n RUN  v4\n[\n  {\n    "filename": "indexyz-pi-a-1.0.0.tgz"\n  }\n]\n';
  assert.equal(parsePackOutput(stdout)[0].filename, "indexyz-pi-a-1.0.0.tgz");
  assert.equal(parsePackOutput('[{"filename":"x.tgz"}]')[0].filename, "x.tgz");
  assert.throws(() => parsePackOutput("no json"), /no JSON/);
});

test("the RPC smoke test needs a successful get_commands response", () => {
  assert.equal(
    rpcAnswered('{"id":"1","type":"response","command":"get_commands","success":true,"data":{}}\n'),
    true,
  );
  assert.equal(rpcAnswered('{"id":"1","type":"response","success":false}\n'), false);
  assert.equal(rpcAnswered("Error: Failed to load extension\n"), false);
});
