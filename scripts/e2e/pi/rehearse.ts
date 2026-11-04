// Rehearses a Pi upgrade the way docs/workflow.md describes one: moves the Pi
// packages' exact host pins to another version, installs, and runs their checks.
// It rewrites manifests and the lockfile, so it runs only in a throwaway checkout.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { isRecord } from "../../release/json.ts";
import { ROOT_DIR, readJsonRecord } from "./world.ts";

const HOST_SCOPE = "@earendil-works/";
const CODING_AGENT = "@earendil-works/pi-coding-agent";
const HOST_VERSION_PROBE = `import("./scripts/e2e/pi/world.ts").then((world) => console.log(world.piHost().version))`;

interface Step {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

function piWorkspaces(): readonly string[] {
  const workspaces = readJsonRecord(join(ROOT_DIR, "package.json"))["workspaces"];
  const names = Array.isArray(workspaces) ? workspaces.map(String) : [];
  return names.filter((name) =>
    isRecord(readJsonRecord(join(ROOT_DIR, name, "package.json"))["pi"]),
  );
}

function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { cwd: ROOT_DIR, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr}`);
  return result.stdout.trim();
}

/** Moves exact host pins only: an `npm:` alias, like pi-ask's legacy host, stays. */
export function repinManifest(source: string, version: string): string {
  const manifest: unknown = JSON.parse(source);
  if (!isRecord(manifest)) throw new Error("package.json must contain a JSON object");
  const dependencies = manifest["devDependencies"];
  if (!isRecord(dependencies)) return source;
  const repinned: Record<string, unknown> = {};
  for (const name of Object.keys(dependencies))
    repinned[name] = name.startsWith(HOST_SCOPE) ? version : dependencies[name];
  return `${JSON.stringify({ ...manifest, devDependencies: repinned }, null, 2)}\n`;
}

function runStep(step: Step): boolean {
  console.log(`\n[rehearsal] ${step.label}`);
  const result = spawnSync(step.command, step.args, { cwd: ROOT_DIR, stdio: "inherit" });
  const passed = result.status === 0;
  console.log(`[rehearsal] ${step.label}: ${passed ? "passed" : "FAILED"}`);
  return passed;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      version: { type: "string", default: "latest" },
      throwaway: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.throwaway)
    throw new Error(
      "this rewrites manifests and the lockfile: pass --throwaway in a scratch checkout",
    );
  const version =
    values.version === "latest"
      ? capture("npm", ["view", CODING_AGENT, "version"])
      : values.version;
  const packages = piWorkspaces();
  for (const name of packages) {
    const path = join(ROOT_DIR, name, "package.json");
    writeFileSync(path, repinManifest(readFileSync(path, "utf8"), version));
  }
  console.log(`[rehearsal] Pi ${version}: ${packages.join(", ")}`);
  const workspaceArgs = packages.flatMap((name) => ["--workspace", name]);
  const steps: readonly Step[] = [
    { label: "install", command: "npm", args: ["install", "--no-audit", "--no-fund"] },
    { label: "typecheck", command: "npm", args: ["run", "typecheck", ...workspaceArgs] },
    { label: "package tests", command: "npm", args: ["test", ...workspaceArgs] },
    { label: "load check", command: "npm", args: ["run", "test:e2e", "--", "--kind", "pi"] },
    { label: "end-to-end scenarios", command: "npm", args: ["run", "test:e2e:pi"] },
  ];
  const failed = steps.filter((step) => !runStep(step)).map((step) => step.label);
  console.log(`[rehearsal] host the scenarios ran: ${capture("node", ["-e", HOST_VERSION_PROBE])}`);
  console.log(`\n[rehearsal] summary for Pi ${version}`);
  console.log(
    failed.length === 0 ? "[rehearsal]   all passed" : `[rehearsal]   FAILED: ${failed.join(", ")}`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(`[rehearsal] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
