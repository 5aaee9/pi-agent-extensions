/**
 * The host entry is loaded by Node as built ESM. A named import of the removed
 * `serviceForAgent` export throws
 * `SyntaxError: does not provide an export named 'serviceForAgent'`
 * on `@deepseek-ai/dsh-agent-preset-registry` 0.2.1-rc.2, before `apply` runs.
 * These checks lock the lookup onto `agentPresets.serviceFor` and prove the
 * built entry evaluates against the real pinned registry that is installed —
 * no module hook or stub replaces the host package.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceUrl = new URL("../index.ts", import.meta.url);
const builtUrl = new URL("../lib/index.js", import.meta.url);

/** Import specifier that must not be a static value import of the removed export. */
const NAMED_SERVICE_FOR_AGENT =
  /import\s+(?!type\b)[^;]*\bserviceForAgent\b[^;]*from\s+["']@deepseek-ai\/dsh-agent-preset-registry["']/;

describe("preset registry entry", () => {
  it("does not statically import the removed serviceForAgent export", () => {
    const source = readFileSync(sourceUrl, "utf8");
    expect(source).not.toMatch(NAMED_SERVICE_FOR_AGENT);
    expect(source).toContain("agentPresets");
    expect(source).toContain("serviceFor");
  });

  it("loads the built host entry as installed ESM against the real registry", () => {
    if (!existsSync(builtUrl)) {
      // `npm run check` builds before tests. A bare `vitest` run before the
      // first build has no host artifact to load; CI always builds first.
      if (process.env.CI === "true") {
        throw new Error("lib/index.js is missing; build the host entry before tests in CI");
      }
      return;
    }
    const built = readFileSync(builtUrl, "utf8");
    expect(built).not.toMatch(NAMED_SERVICE_FOR_AGENT);

    const result = spawnSync(process.execPath, [fileURLToPath(builtUrl)], { encoding: "utf8" });
    expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toEqual({
      status: 0,
      stderr: "",
      stdout: "",
    });
  });
});
