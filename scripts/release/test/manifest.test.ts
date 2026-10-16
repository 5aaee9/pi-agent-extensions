// The manifest fields the release engine reads, and the smoke check they select.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseManifest } from "../json.ts";
import { smokeCheck } from "../plan-core.ts";

const pkg = (extra: Readonly<Record<string, unknown>> = {}): string =>
  `${JSON.stringify({ name: "@indexyz/pi-a", version: "0.1.0", ...extra }, null, 2)}\n`;

void test("a manifest without a release block has no smoke script", () => {
  const manifest = parseManifest(pkg({ pi: { extensions: ["./index.ts"] } }), "package.json");
  assert.equal(manifest.smoke, null);
  assert.equal(manifest.dsh, false);
  assert.deepEqual(manifest.piResources, ["./index.ts"]);
});

void test("a dsh manifest marks a package the Harness installs", () => {
  const manifest = parseManifest(
    pkg({ dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    "package.json",
  );
  assert.equal(manifest.dsh, true);
  assert.deepEqual(manifest.piResources, []);
});

void test("release.smoke is read as declared", () => {
  const manifest = parseManifest(
    pkg({
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
      release: { smoke: "test/smoke-release.ts" },
    }),
    "package.json",
  );
  assert.equal(manifest.smoke, "test/smoke-release.ts");
  assert.deepEqual(manifest.piResources, []);
});

void test("a smoke script that is not a relative TypeScript path is rejected", () => {
  for (const smoke of ["test/smoke.js", "/test/smoke.ts", ""]) {
    assert.throws(
      () => parseManifest(pkg({ release: { smoke } }), "package.json"),
      /release\.smoke/u,
      `expected "${smoke}" to be rejected`,
    );
  }
});

void test("Pi resources select the Pi load and a declared script selects itself", () => {
  const pi = parseManifest(pkg({ pi: { extensions: ["./index.ts"] } }), "package.json");
  assert.deepEqual(smokeCheck(pi), { kind: "pi" });

  const dsh = parseManifest(pkg({ release: { smoke: "test/smoke-release.ts" } }), "package.json");
  assert.deepEqual(smokeCheck(dsh), { kind: "declared", script: "test/smoke-release.ts" });
});

void test("a declared script wins over Pi resources, so one package can choose its own check", () => {
  const both = parseManifest(
    pkg({ pi: { extensions: ["./index.ts"] }, release: { smoke: "test/smoke-release.ts" } }),
    "package.json",
  );
  assert.deepEqual(smokeCheck(both), { kind: "declared", script: "test/smoke-release.ts" });
});

void test("a package with neither Pi resources nor a declared script cannot be verified", () => {
  const none = parseManifest(pkg(), "package.json");
  assert.throws(() => smokeCheck(none), /release\.smoke/u);
});
