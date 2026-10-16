import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inspectTarball,
  packedFilename,
  type PlannedPackage,
  type PlanOps,
  planPackage,
  planPackages,
  type RecordItem,
  rpcAnswered,
} from "../plan-core.ts";

const V1 = "1111111111111111111111111111111111111111";
const V2 = "2222222222222222222222222222222222222222";
const dated = "# Changelog\n\n## 0.1.43 - 2026-10-11\n\n- Old.\n";
const exact = (version: string, line = "- Fix."): string =>
  `# Changelog\n\n## ${version}\n\n### Patch Changes\n\n${line}\n\n${dated.slice(13)}`;

interface CommitFacts {
  readonly version: string;
  readonly changelog?: string;
}

interface World {
  readonly versionCommit?: string;
  readonly commits: Readonly<Record<string, CommitFacts>>;
  readonly tags?: Readonly<Record<string, string>>;
  readonly registry?: readonly string[];
  readonly releases?: readonly string[];
}

/** Command doubles that also record the registry and GitHub lookups made. */
function recordingOps(world: World): { readonly ops: PlanOps; readonly calls: readonly string[] } {
  const calls: string[] = [];
  const { versionCommit = V1, commits, tags = {}, registry = [], releases = [] } = world;
  const ops: PlanOps = {
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
  return { ops, calls };
}

/** Command doubles describing Git history, the registry, and GitHub Releases. */
const ops = (world: World): PlanOps => recordingOps(world).ops;

const pkg = (version: string): PlannedPackage => ({
  name: "@indexyz/pi-skill",
  dir: "pi-skill",
  version,
});

function recordOf(record: RecordItem | null): RecordItem {
  assert.ok(record, "expected record work");
  return record;
}

void test("an absent version with an exact section is an upload and needs its tag and Release", () => {
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

void test("an absent version without an exact section fails", () => {
  const result = planPackage(
    pkg("0.1.44"),
    ops({ commits: { [V1]: { version: "0.1.44", changelog: dated } } }),
  );
  assert.match(result.errors[0] ?? "", /no "## 0.1.44" section/u);
  assert.equal(result.upload, null);
});

void test("an absent version with a duplicate section fails", () => {
  const twice = `${exact("0.1.44")}\n## 0.1.44\n\n- Again.\n`;
  const result = planPackage(
    pkg("0.1.44"),
    ops({ commits: { [V1]: { version: "0.1.44", changelog: twice } } }),
  );
  assert.match(result.errors[0] ?? "", /2 "## 0.1.44" sections/u);
});

void test("0.1.43 untagged with a dated heading is tag work only", () => {
  const { ops: doubles, calls } = recordingOps({
    commits: { [V1]: { version: "0.1.43", changelog: dated } },
    registry: ["@indexyz/pi-skill@0.1.43"],
  });
  const result = planPackage(pkg("0.1.43"), doubles);
  assert.equal(result.upload, null);
  assert.equal(recordOf(result.record).needsTag, true);
  assert.equal(recordOf(result.record).needsRelease, false);
  assert.match(result.notices[0] ?? "", /tag and no Release/u);
  assert.ok(!calls.some((call) => call.startsWith("gh")), "no Release lookup without a section");
});

void test("0.1.43 tagged with a dated heading and no Release is no work", () => {
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

void test("a second plan after the tags exist is empty", () => {
  const names = ["pi-skill", "pi-continue"];
  const packages: readonly PlannedPackage[] = names.map((dir) => ({
    name: `@indexyz/${dir}`,
    dir,
    version: "0.1.43",
  }));
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

void test("a published, tagged version with a section and no Release is Release work", () => {
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
      needsTag: recordOf(result.record).needsTag,
      needsRelease: recordOf(result.record).needsRelease,
      recordCommit: recordOf(result.record).recordCommit,
    },
    { needsTag: false, needsRelease: true, recordCommit: V1 },
  );
});

void test("a complete version is no work", () => {
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

void test("a tag at another commit carrying the version is accepted and is the record commit", () => {
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
  assert.equal(recordOf(result.record).recordCommit, V1);
  assert.equal(recordOf(result.record).versionCommit, V2);
  assert.equal(recordOf(result.record).needsTag, false);
});

void test("a tag at a commit not carrying the version fails", () => {
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
  assert.match(result.errors[0] ?? "", /carries 0.1.40; the tag is never moved/u);
});

void test("a registry lookup failure is not absence", () => {
  const failing: PlanOps = {
    ...ops({ commits: {} }),
    registryHas: () => {
      throw new Error("npm view failed (exit 1) E401");
    },
  };
  assert.throws(() => planPackage(pkg("0.1.44"), failing), /E401/u);
});

const files = ["index.ts", "data/bank.json", "README.md", "CHANGELOG.md", "LICENSE"];
const good = ["package.json", "README.md", "CHANGELOG.md", "LICENSE", "index.ts", "data/bank.json"];
const inspect = (
  entries: readonly string[],
  packed?: { readonly name: string; readonly version: string },
): string[] =>
  inspectTarball({
    name: "@indexyz/pi-a",
    version: "1.0.0",
    files,
    piResources: ["./index.ts"],
    entries,
    packed: packed ?? { name: "@indexyz/pi-a", version: "1.0.0" },
  });

void test("tarball inspection accepts a complete package", () => {
  assert.deepEqual(inspect(good), []);
});

void test("tarball inspection reports missing resources, tests, OpenSpec files, and a wrong manifest", () => {
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
    files: ["README.md"],
    piResources: ["./index.ts"],
    entries: ["package.json", "README.md", "CHANGELOG.md", "LICENSE"],
    packed: { name: "@indexyz/pi-a", version: "1.0.0" },
  });
  assert.deepEqual(noExtension, ["missing Pi resource index.ts"]);
});

void test("npm pack output is parsed after lifecycle script output", () => {
  const stdout =
    '\n> prepack\n> vitest run\n\n RUN  v4\n[\n  {\n    "filename": "indexyz-pi-a-1.0.0.tgz"\n  }\n]\n';
  assert.equal(packedFilename(stdout), "indexyz-pi-a-1.0.0.tgz");
  assert.equal(packedFilename('[{"filename":"dir/x.tgz"}]'), "x.tgz");
  assert.throws(() => packedFilename("no json"), /no JSON/u);
  assert.throws(() => packedFilename("[{}]"), /no tarball file name/u);
});

void test("the RPC smoke test needs a successful get_commands response", () => {
  assert.equal(
    rpcAnswered('{"id":"1","type":"response","command":"get_commands","success":true,"data":{}}\n'),
    true,
  );
  assert.equal(rpcAnswered('{"id":"1","type":"response","success":false}\n'), false);
  assert.equal(rpcAnswered("Error: Failed to load extension\n"), false);
});
