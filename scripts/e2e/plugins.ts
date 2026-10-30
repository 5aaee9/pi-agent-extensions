import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { isRecord, type JsonRecord } from "../release/json.ts";
import { CommandOptions, commandFailure, runCommand, shorten } from "./runtime.ts";

interface PluginPackage {
  readonly dir: string;
  readonly name: string;
  readonly kind: "pi" | "dsh";
  readonly extensions: readonly string[];
  readonly smoke: string | null;
}
interface PackageResult {
  readonly package: PluginPackage;
  readonly passed: boolean;
  readonly durationMs: number;
}
const DEFAULT_TIMEOUT_MS = 120_000;
const rootDir = resolve(import.meta.dirname, "../..");

function manifest(path: string): JsonRecord {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object`);
  return value;
}
function objects(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}
function strings(value: unknown, source: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${source} must be an array of strings`);
  return value.filter((item): item is string => typeof item === "string");
}
function discoverPackages(): PluginPackage[] {
  const root = manifest(join(rootDir, "package.json"));
  const workspaces = strings(root["workspaces"], "root package.json workspaces");
  const packages: PluginPackage[] = [];
  for (const workspace of workspaces) {
    const dir = resolve(rootDir, workspace);
    const path = join(dir, "package.json");
    const packageManifest = manifest(path);
    if (packageManifest["private"] === true) continue;
    const name = packageManifest["name"];
    if (typeof name !== "string" || name === "")
      throw new Error(`${path} must declare a package name`);
    const pi = objects(packageManifest["pi"]);
    const dsh = objects(packageManifest["dsh"]);
    if (pi !== null && dsh !== null)
      throw new Error(`${path} cannot declare both pi and dsh manifests`);
    if (pi !== null) {
      const extensions = strings(pi["extensions"], `${path} pi.extensions`);
      if (extensions.length === 0) throw new Error(`${path} pi.extensions must not be empty`);
      packages.push({ dir, name, kind: "pi", extensions, smoke: null });
      continue;
    }
    if (dsh !== null) {
      const release = objects(packageManifest["release"]);
      const smoke = release?.["smoke"];
      if (
        typeof smoke !== "string" ||
        smoke === "" ||
        smoke.startsWith("/") ||
        !smoke.endsWith(".ts")
      )
        throw new Error(`${path} must declare a relative release.smoke .ts script`);
      packages.push({ dir, name, kind: "dsh", extensions: [], smoke });
    }
  }
  return packages.toSorted((left, right) => left.name.localeCompare(right.name));
}
function npmEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, CI: "1", npm_config_update_notifier: "false", npm_config_fund: "false" };
}
function piBinary(packageDir: string): string {
  const binaryName = process.platform === "win32" ? "pi.cmd" : "pi";
  const local = join(packageDir, "node_modules", ".bin", binaryName);
  const root = join(rootDir, "node_modules", ".bin", binaryName);
  if (existsSync(local)) return local;
  if (existsSync(root)) return root;
  throw new Error(`no Pi binary found at ${local} or ${root}`);
}
function parseRpcResponse(output: string): JsonRecord | undefined {
  return output
    .split("\n")
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return isRecord(value) ? [value] : [];
      } catch {
        return [];
      }
    })
    .find((value) => value["type"] === "response" && value["command"] === "get_commands");
}
function checkPi(pkg: PluginPackage, timeoutMs: number): void {
  const configDir = mkdtempSync(join(tmpdir(), "pi-e2e-config-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "pi-e2e-session-"));
  try {
    const args = [
      "--mode",
      "rpc",
      "--no-session",
      "--session-dir",
      sessionDir,
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--approve",
      "--offline",
      "--no-builtin-tools",
      ...pkg.extensions.flatMap((extension) => ["--extension", resolve(pkg.dir, extension)]),
    ];
    const result = runCommand(
      piBinary(pkg.dir),
      args,
      new CommandOptions(
        pkg.dir,
        timeoutMs,
        { ...npmEnvironment(), PI_CODING_AGENT_DIR: configDir, PI_OFFLINE: "1" },
        '{"type":"get_commands"}\n',
      ),
    );
    if (result.code !== 0 || result.timedOut) throw new Error(commandFailure(result));
    if (parseRpcResponse(result.stdout)?.["success"] !== true)
      throw new Error(
        `Pi RPC did not return a successful get_commands response\n${commandFailure(result)}`,
      );
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  }
}
function checkDsh(pkg: PluginPackage, timeoutMs: number): void {
  if (pkg.smoke === null) throw new Error("DSH package has no release.smoke script");
  const tempRoot = mkdtempSync(join(tmpdir(), "dsh-e2e-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  const cacheDir = join(tempRoot, "npm-cache");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  try {
    const commandOptions = new CommandOptions(pkg.dir, timeoutMs, {
      ...npmEnvironment(),
      npm_config_cache: cacheDir,
    });
    const build = runCommand("npm", ["run", "build"], commandOptions);
    if (build.code !== 0 || build.timedOut) throw new Error(commandFailure(build));
    const pack = runCommand(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packDir, "--json"],
      commandOptions,
    );
    if (pack.code !== 0 || pack.timedOut) throw new Error(commandFailure(pack));
    const tarball = readdirSync(packDir).find((entry) => entry.endsWith(".tgz"));
    if (tarball === undefined)
      throw new Error(`npm pack produced no tarball\n${shorten(pack.stdout)}`);
    const install = runCommand(
      "npm",
      ["install", "--ignore-scripts", "--omit=peer", "--legacy-peer-deps", join(packDir, tarball)],
      new CommandOptions(installDir, timeoutMs, {
        ...npmEnvironment(),
        npm_config_cache: cacheDir,
      }),
    );
    if (install.code !== 0 || install.timedOut) throw new Error(commandFailure(install));
    const packagePath = join(installDir, "node_modules", ...pkg.name.split("/"));
    const smoke = runCommand(
      process.execPath,
      [resolve(pkg.dir, pkg.smoke), packagePath],
      commandOptions,
    );
    if (smoke.code !== 0 || smoke.timedOut) throw new Error(commandFailure(smoke));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
function checkPackage(pkg: PluginPackage, timeoutMs: number): PackageResult {
  const started = Date.now();
  console.log(`[e2e] ${pkg.name} (${pkg.kind}) starting`);
  try {
    if (pkg.kind === "pi") checkPi(pkg, timeoutMs);
    else checkDsh(pkg, timeoutMs);
    const durationMs = Date.now() - started;
    console.log(`[e2e] ${pkg.name} passed (${durationMs}ms)`);
    return { package: pkg, passed: true, durationMs };
  } catch (error: unknown) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[e2e] ${pkg.name} failed (${durationMs}ms)\n${message}`);
    return { package: pkg, passed: false, durationMs };
  }
}
function options(): { readonly packageName: string | undefined; readonly timeoutMs: number } {
  const parsed = parseArgs({
    options: {
      package: { type: "string" },
      "timeout-ms": { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
    },
    strict: true,
  });
  const timeoutMs = Number(parsed.values["timeout-ms"]);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("--timeout-ms must be a positive integer");
  return { packageName: parsed.values.package, timeoutMs };
}
function main(): void {
  const selected = options();
  const discovered = discoverPackages();
  const packages =
    selected.packageName === undefined
      ? discovered
      : discovered.filter((pkg) => pkg.name === selected.packageName);
  if (packages.length === 0)
    throw new Error(
      selected.packageName === undefined
        ? "no Pi or DSH packages discovered"
        : `package not discovered: ${selected.packageName}`,
    );
  console.log(
    `[e2e] discovered ${packages.length} plugin(s): ${packages.map((pkg) => pkg.name).join(", ")}`,
  );
  const results = packages.map((pkg) => checkPackage(pkg, selected.timeoutMs));
  const failed = results.filter((result) => !result.passed);
  console.log(
    `[e2e] summary: total=${results.length} passed=${results.length - failed.length} failed=${failed.length}`,
  );
  if (failed.length > 0) {
    console.error(
      `[e2e] failed packages: ${failed.map((result) => result.package.name).join(", ")}`,
    );
    process.exitCode = 1;
  }
}
try {
  main();
} catch (error: unknown) {
  console.error(`[e2e] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
