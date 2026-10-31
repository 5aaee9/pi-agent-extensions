/**
 * Shared helper for driving this package's client half through the real Harness web
 * plane (`docs/conventions.md`, "Tests"; AGENTS.md rule 5).
 *
 * It starts the pinned host CLI (`@deepseek-ai/dsh`, a devDependency pinned to the
 * host version this package builds against) as a real `dsh web` server over a
 * throwaway `DSH_HOME`, installs *this* package into the host's web profile exactly
 * the way the Harness installs any plugin (`dsh plugin --profile web add`), and drives
 * the served page with a real Chromium browser. Nothing here replaces a host module:
 * the slot registry, locale service, settings service, session model catalog, and UI
 * primitives all come from the running host, and every assertion runs against the DOM
 * the host itself renders.
 *
 * The model catalog comes from the base bundle's own dormant `llm-pi-ai` adapter: the
 * profile patch gives it a `providers` section, exactly as the host's Models page
 * would, routing to a locally started OpenAI-compatible server (`model-server.ts`).
 * No third-party plugin and no network access is involved.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const requireFromHere = createRequire(import.meta.url);

export interface WebPlane {
  readonly home: string;
  /** The web profile's patch document, the file the host's settings service writes. */
  readonly patchPath: string;
  /** The authenticated page URL; it carries the host token, so never print it. */
  readonly pageUrl: string;
  close(): Promise<void>;
}

export interface WebPlaneOptions {
  /** Profile patch entries written before the server boots (for example a `llm-pi-ai` section). */
  readonly patch?: readonly unknown[];
  /** Extra environment for the server, such as a route's credential reference. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** Resolve the CLI script a host package ships. */
function hostCli(): string {
  return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
}

/** Every server this process started; killed on exit even if a caller forgot to close. */
const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    // Detached children lead their own process group: take down anything they spawned.
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone; fall back to the child itself.
    child.kill(signal);
  }
}

function track(child: ChildProcess): void {
  live.add(child);
  child.once("exit", () => live.delete(child));
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const running of live) killGroup(running, "SIGKILL");
  });
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Stop a detached child and its group: SIGTERM, then SIGKILL after `graceMs`. */
async function stopChild(child: ChildProcess, graceMs = 10_000): Promise<void> {
  if (exited(child)) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      killGroup(child, "SIGKILL");
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killGroup(child, "SIGTERM");
  });
}

/** Run one host CLI command to completion without blocking the event loop. */
async function runHost(home: string, args: readonly string[], timeoutMs: number): Promise<void> {
  const child = spawn(process.execPath, [hostCli(), ...args], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  track(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      killGroup(child, "SIGKILL");
      reject(
        new Error(
          `dsh ${args.join(" ")} did not finish within ${String(timeoutMs)} ms:\n${output}`,
        ),
      );
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  if (code !== 0)
    throw new Error(`dsh ${args.join(" ")} exited with ${String(code)}:\n${output.trim()}`);
}

/**
 * Boot `dsh web` on a free port and wait until it reports its authenticated URL.
 * `onSpawn` receives the child before the wait, so a caller can always stop it.
 */
async function startWebServer(
  home: string,
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
  onSpawn: (child: ChildProcess) => void,
): Promise<string> {
  const child = spawn(process.execPath, [hostCli(), "web", "--no-open", "--port", "0"], {
    env: { ...process.env, ...env, DSH_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  track(child);
  onSpawn(child);
  let buffer = "";
  return await new Promise<string>((resolve, reject) => {
    const fail = (error: Error): void => {
      clearTimeout(timer);
      killGroup(child, "SIGKILL");
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`dsh web did not report a URL within ${String(timeoutMs)} ms:\n${buffer}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", fail);
    child.once("exit", (code) => {
      fail(new Error(`dsh web exited with ${String(code)} before reporting a URL:\n${buffer}`));
    });
  });
}

/**
 * Install `sources` into a throwaway web profile, write `options.patch` as the
 * profile's patch layer, and boot the real web app. The caller owns the plane and
 * must close it; a failure at any step stops the server and removes the profile.
 */
export async function openWebPlane(
  sources: readonly string[],
  options: WebPlaneOptions = {},
): Promise<WebPlane> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const home = mkdtempSync(join(tmpdir(), "dsh-thread-summary-plane-"));
  const patchPath = join(home, "profiles", "web", "cordis.patch.yml");
  let child: ChildProcess | undefined;
  const close = async (): Promise<void> => {
    if (child !== undefined) await stopChild(child);
    rmSync(home, { recursive: true, force: true });
  };
  try {
    for (const source of sources) {
      await runHost(home, ["plugin", "--profile", "web", "add", source], 180_000);
    }
    if (options.patch !== undefined) {
      writeFileSync(patchPath, `${JSON.stringify(options.patch, undefined, 2)}\n`);
    }
    const pageUrl = await startWebServer(home, options.env ?? {}, timeoutMs, (spawned) => {
      child = spawned;
    });
    return { home, patchPath, pageUrl, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Launch the real Chromium the pinned Playwright provisioned. */
export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch();
}

/**
 * Fail fast when the built artifacts a plane install consumes are older than the
 * sources they come from: `dsh plugin add <dir>` links the directory, so the host
 * serves whatever `lib/` and `client.js` are on disk.
 */
export function assertFreshBuild(packageDir: string): void {
  const newest = (path: string): number => {
    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.mtimeMs;
    return Math.max(0, ...readdirSync(path).map((name) => newest(join(path, name))));
  };
  const sources = Math.max(newest(join(packageDir, "index.ts")), newest(join(packageDir, "src")));
  for (const artifact of ["lib/index.js", "client.js"]) {
    let built: number;
    try {
      built = statSync(join(packageDir, artifact)).mtimeMs;
    } catch {
      throw new Error(`${artifact} is missing: run \`npm run build\` in ${packageDir} first`);
    }
    if (built < sources) {
      throw new Error(
        `${artifact} is older than the sources it is built from: run \`npm run build\` in ${packageDir} first`,
      );
    }
  }
}

/** The host's first-run dialogs and the control each is dismissed with. */
const FIRST_RUN_DIALOGS = [
  { dialog: /^Preview Notice$/u, control: /^Continue$/u },
  // Shown while no account and no API key is configured; its own close control.
  { dialog: /^Get started$/u, control: /^Close$/u },
];

/**
 * Load the page and open the host's Settings sheet. The wait selector is this
 * package's own rendered root: the host mounts the row through the real
 * `settings.general.item` slot, so it only appears when the client module loaded,
 * applied, and rendered in the live page.
 */
export async function openSettingsSheet(
  page: Page,
  url: string,
  waitSelector: string,
): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await reopenSettingsSheet(page, waitSelector);
}

/** Open the Settings sheet in an already loaded page (for example after a reload). */
export async function reopenSettingsSheet(page: Page, waitSelector: string): Promise<void> {
  const account = page.getByRole("button", { name: "Account menu" });
  await account.waitFor({ state: "visible", timeout: 30_000 });
  await dismissFirstRunDialogs(page);
  await account.click({ timeout: 10_000 });
  const settings = page.getByRole("menuitem", { name: "Settings" }).first();
  await settings.click({ timeout: 10_000 });
  await page.locator(waitSelector).waitFor({ state: "visible", timeout: 15_000 });
  // The row finishes loading when the host's settings and catalog replies arrive.
  await page
    .locator(`${waitSelector}[aria-busy=false]`)
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Close each first-run dialog through its own dismiss control. A dialog with no
 * such control fails the call, naming it, rather than being clicked through blindly.
 */
async function dismissFirstRunDialogs(page: Page): Promise<void> {
  const dialogs = page.locator("[role=dialog],[role=alertdialog]");
  for (let round = 0; round < 5; round += 1) {
    // A dialog may mount a moment after the shell; give it that moment, no more.
    const present = await dialogs
      .first()
      .waitFor({ state: "visible", timeout: round === 0 ? 2_000 : 500 })
      .then(
        () => true,
        () => false,
      );
    if (!present) return;
    const dialog = dialogs.first();
    const label = ((await dialog.getAttribute("aria-label")) ?? (await dialog.innerText())).slice(
      0,
      120,
    );
    const rule = FIRST_RUN_DIALOGS.find((entry) => entry.dialog.test(label));
    const control =
      rule === undefined ? undefined : dialog.getByRole("button", { name: rule.control }).first();
    if (control === undefined || (await control.count()) === 0) {
      throw new Error(`an unexpected dialog blocks the page: ${JSON.stringify(label)}`);
    }
    await control.click({ timeout: 5_000 });
    await dialog.waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
  }
}
