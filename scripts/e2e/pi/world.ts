// An isolated Pi installation: tarballs packed from this checkout, installed by
// Pi's own install command into directories nothing else shares. Users get the
// same shape from `pi install`, with no host package beside the installed copy.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { isRecord } from "../../release/json.ts";

export const ROOT_DIR = resolve(import.meta.dirname, "../../..");
const INSTALL_TIMEOUT_MS = 90_000;

export function readJsonRecord(path: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object`);
  return value;
}

/** The entries a session file holds, in the order Pi wrote them. */
export function sessionEntries(path: string): readonly Readonly<Record<string, unknown>>[] {
  const entries: unknown[] = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  return entries.filter((entry) => isRecord(entry));
}

/** The published `pi` bin of the host this checkout resolves. */
export function piBin(): string {
  const manifestPath = findPackageJSON(
    "@earendil-works/pi-coding-agent",
    pathToFileURL(join(ROOT_DIR, "package.json")),
  );
  if (manifestPath === undefined) throw new Error("Pi is not installed; run npm install");
  const bin = readJsonRecord(manifestPath)["bin"];
  const entry = isRecord(bin) ? bin["pi"] : undefined;
  if (typeof entry !== "string") throw new Error(`${manifestPath} does not declare bin.pi`);
  return resolve(dirname(manifestPath), entry);
}

export function assertNoNodeModulesAncestor(path: string): void {
  if (path.split(sep).includes("node_modules"))
    throw new Error(
      `temporary root ${path} sits under a node_modules tree, which would let an installed package resolve host packages; set TMPDIR elsewhere`,
    );
}

const tarballs = new Map<string, string>();

/** Packs a workspace package once per process. */
export function tarballFor(name: string): string {
  const packed = tarballs.get(name);
  if (packed !== undefined) return packed;
  const dir = mkdtempSync(join(tmpdir(), "pi-e2e-pack-"));
  process.once("exit", () => {
    rmSync(dir, { recursive: true, force: true });
  });
  const result = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--silent", "--pack-destination", dir],
    {
      cwd: join(ROOT_DIR, name),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        npm_config_cache: join(dir, "npm-cache"),
        npm_config_logs_dir: join(dir, "npm-logs"),
        npm_config_update_notifier: "false",
        npm_config_fund: "false",
      },
    },
  );
  if (result.status !== 0)
    throw new Error(`npm pack failed for ${name}\n${result.stdout}\n${result.stderr}`);
  const tarball = readdirSync(dir).find((entry) => entry.endsWith(".tgz"));
  if (tarball === undefined) throw new Error(`npm pack produced no tarball for ${name}`);
  const path = join(dir, tarball);
  tarballs.set(name, path);
  return path;
}

export interface WorldOptions {
  /** Directory names of the packages to install. */
  readonly packages: readonly string[];
  /**
   * Whether Pi runs offline. Off only where a package's own discovery, billing,
   * or usage traffic must reach a local server.
   */
  readonly offline?: boolean;
}

export type EnvExtra = Readonly<Record<string, string>>;

export interface World {
  readonly root: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly cwd: string;
  readonly env: (extra?: EnvExtra) => NodeJS.ProcessEnv;
  readonly install: (name: string, tarball?: string) => void;
  readonly writeAgentFile: (path: string, content: unknown) => string;
  /** Merges into `settings.json`, which also records what `pi install` installed. */
  readonly mergeSettings: (settings: Readonly<Record<string, unknown>>) => void;
  readonly dispose: () => void;
}

function worldEnv(root: string, offline: boolean, extra: EnvExtra): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    npm_config_cache: join(root, "npm-cache"),
    npm_config_logs_dir: join(root, "npm-logs"),
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  };
  delete env["PI_OFFLINE"];
  if (offline) env["PI_OFFLINE"] = "1";
  return { ...env, ...extra };
}

function mergeSettingsFile(agentDir: string, settings: Readonly<Record<string, unknown>>): void {
  const target = join(agentDir, "settings.json");
  const current = existsSync(target) ? readJsonRecord(target) : {};
  writeFileSync(target, JSON.stringify({ ...current, ...settings }));
}

function piInstall(
  name: string,
  tarball: string,
  cwd: string,
  env: Readonly<NodeJS.ProcessEnv>,
): void {
  const result = spawnSync(
    process.execPath,
    [piBin(), "install", `npm:@indexyz/${name}@file:${tarball}`],
    { cwd, encoding: "utf8", timeout: INSTALL_TIMEOUT_MS, env },
  );
  if (result.status !== 0)
    throw new Error(`pi install failed for ${name}\n${result.stdout}\n${result.stderr}`);
}

export function createWorld(options: WorldOptions): World {
  const root = mkdtempSync(join(tmpdir(), "pi-e2e-"));
  assertNoNodeModulesAncestor(root);
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const cwd = join(root, "cwd");
  for (const dir of [agentDir, sessionDir, join(root, "home"), cwd])
    mkdirSync(dir, { recursive: true });
  const remove = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  process.once("exit", remove);
  const offline = options.offline ?? true;
  const env = (extra: EnvExtra = {}): NodeJS.ProcessEnv => worldEnv(root, offline, extra);
  const install = (name: string, tarball = tarballFor(name)): void => {
    piInstall(name, tarball, cwd, env({ npm_config_offline: "true", PI_OFFLINE: "1" }));
  };
  for (const name of options.packages) install(name);
  return {
    root,
    agentDir,
    sessionDir,
    cwd,
    env,
    install,
    writeAgentFile(path, content) {
      if (path === "settings.json")
        throw new Error("use mergeSettings: settings.json lists the installed packages");
      const target = join(agentDir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content));
      return target;
    },
    mergeSettings: (settings) => {
      mergeSettingsFile(agentDir, settings);
    },
    dispose() {
      process.removeListener("exit", remove);
      remove();
    },
  };
}

export const PROBE_PROVIDER = "probe";
export const PROBE_MODEL = "m";
/** Selects the `models.json` model `probeModels` declares. */
export const PROBE_ARGS: readonly string[] = [
  "--provider",
  PROBE_PROVIDER,
  "--model",
  PROBE_MODEL,
  "--approve",
];

export interface ProbeModelOptions {
  readonly reasoning?: boolean;
  readonly contextWindow?: number;
}

/** A `models.json` document for a provider Pi's own client streams from `baseUrl`. */
export function probeModels(baseUrl: string, options: ProbeModelOptions = {}): unknown {
  return {
    providers: {
      [PROBE_PROVIDER]: {
        baseUrl,
        api: "openai-completions",
        apiKey: "local",
        models: [
          {
            id: PROBE_MODEL,
            name: PROBE_MODEL,
            reasoning: options.reasoning ?? false,
            input: ["text"],
            contextWindow: options.contextWindow ?? 1_000_000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
}
