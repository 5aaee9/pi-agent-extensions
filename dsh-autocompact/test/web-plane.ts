/**
 * Shared helper for driving this package's client half through the real Harness web
 * plane (`docs/conventions.md`, "Tests"; AGENTS.md rule 5).
 *
 * It starts the pinned host CLI (`@deepseek-ai/dsh`, a devDependency pinned to the
 * host version this package builds against) as a real `dsh web` server over a
 * throwaway `DSH_HOME`, installs *this* package into the host's web profile exactly
 * the way the Harness installs any plugin (`dsh plugin --profile web add`), and
 * drives the served page with a real Chromium browser. Nothing here replaces a host
 * module: the slot registry, locale service, settings service, session store, model
 * catalog and UI primitives all come from the running host, and every assertion runs
 * against the DOM the host itself renders.
 *
 * Process hygiene: every host process this module starts is its own process group,
 * is tracked from the moment it is spawned, is killed (whole group) when its startup
 * fails or times out, and is killed by a `process` exit hook if a caller never closes
 * it, so a failed or interrupted run cannot leave a `dsh web` server behind. The
 * server runs with `HOME` pointed into the throwaway directory, so the host's
 * directory picker lists a real workspace there and nothing is written to the
 * caller's home.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const requireFromHere = createRequire(import.meta.url);
const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export interface WebPlane {
  readonly home: string;
  /** The authenticated page URL; it carries the host token, so never print it. */
  readonly pageUrl: string;
  /** The real workspace directory the host's picker lists. */
  readonly workspace: string;
  close(): Promise<void>;
}

export interface WebPlaneOptions {
  /** Package sources `dsh plugin add` installs, in order. */
  readonly sources: readonly string[];
  /** The profile's user patch layer (YAML), written before the server boots. */
  readonly patch?: string;
  /** Extra environment for the server process (for example a route's credential). */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** Host processes this module started and has not yet seen exit. */
const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    // The group is already gone; fall back to the direct child.
    child.kill(signal);
  }
}

/** Spawn one host process in its own group and track it until it exits. */
function spawnHost(args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Last line of defence: a caller that crashed before `close()` still leaves no server.
    process.once("exit", () => {
      for (const child of live) killGroup(child, "SIGKILL");
    });
  }
  const child = spawn(process.execPath, [hostCli(), ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  live.add(child);
  child.once("exit", () => {
    live.delete(child);
  });
  return child;
}

/** Stop a host process group: SIGTERM, then SIGKILL after a grace period. */
async function stopHost(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
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

/** Resolve the CLI script a host package ships. */
function hostCli(): string {
  return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
}

/**
 * Fail fast when the built artifacts the plane installs are older than the sources
 * they are built from: `dsh plugin add` links this directory as it sits on disk, so
 * a stale `lib/` or `client.js` would be asserted instead of the code under review.
 */
export function assertFreshBuild(): void {
  const newest = (paths: readonly string[]): number =>
    Math.max(...paths.map((path) => statSync(join(packageDir, path)).mtimeMs));
  const sources = newest(["index.ts", "compaction.ts", "settings.ts"]);
  const clientSources = newest(
    readdirSync(join(packageDir, "src/client")).map((file) => join("src/client", file)),
  );
  for (const [artifact, built] of [
    ["lib/index.js", sources],
    ["client.js", clientSources],
  ] as const) {
    let mtime: number;
    try {
      mtime = statSync(join(packageDir, artifact)).mtimeMs;
    } catch {
      throw new Error(`${artifact} is missing; run \`npm run build\` before the real-plane tests`);
    }
    if (mtime < built) {
      throw new Error(`${artifact} is older than its sources; run \`npm run build\` first`);
    }
  }
}

/** Run one host CLI command to completion, killing it if it outlives `timeoutMs`. */
async function runHost(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const child = spawnHost(args, env);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      killGroup(child, "SIGKILL");
      reject(new Error(`dsh ${args.join(" ")} did not finish within ${String(timeoutMs)} ms`));
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

/** Boot `dsh web` on a free port and wait until it reports its authenticated URL. */
async function startWebServer(
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ url: string; child: ChildProcess }> {
  const child = spawnHost(["web", "--no-open", "--port", "0"], env);
  let buffer = "";
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`dsh web did not report a URL within ${String(timeoutMs)} ms:\n${buffer}`),
        );
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
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`dsh web exited with ${String(code)} before reporting a URL:\n${buffer}`));
      });
    });
    return { url, child };
  } catch (error) {
    // The server never became usable: it must not outlive this attempt.
    await stopHost(child, 1_000);
    throw error;
  }
}

/**
 * Install `sources` into a throwaway web profile and boot the real web app. The
 * caller owns the plane and must close it.
 */
export async function openWebPlane(options: WebPlaneOptions): Promise<WebPlane> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const home = mkdtempSync(join(tmpdir(), "dsh-ac-plane-"));
  const userHome = join(home, "user");
  const workspace = join(userHome, "autocompact-workspace");
  let child: ChildProcess | undefined;
  const cleanup = async (): Promise<void> => {
    if (child !== undefined) await stopHost(child);
    rmSync(home, { recursive: true, force: true });
  };
  try {
    mkdirSync(workspace, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, DSH_HOME: home };
    for (const source of options.sources) {
      await runHost(["plugin", "--profile", "web", "add", source], env, 180_000);
    }
    if (options.patch !== undefined) {
      writeFileSync(join(home, "profiles", "web", "cordis.patch.yml"), options.patch);
    }
    const started = await startWebServer({ ...env, HOME: userHome }, timeoutMs);
    child = started.child;
    return { home, workspace, pageUrl: started.url, close: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Launch the real Chromium the pinned Playwright provisioned. */
export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch();
}

/**
 * Run `body` and then every closer, collecting failures instead of swallowing them:
 * a body failure wins, and a teardown failure is reported rather than hidden.
 */
export async function withTeardown<T>(
  body: () => Promise<T>,
  closers: ReadonlyArray<(() => Promise<unknown>) | undefined>,
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = await body();
  } catch (error) {
    failure = error;
    failed = true;
  }
  const teardown: unknown[] = [];
  for (const close of closers) {
    if (close === undefined) continue;
    try {
      await close();
    } catch (error) {
      teardown.push(error);
    }
  }
  if (failed) {
    for (const error of teardown) console.error("web-plane teardown failed:", error);
    throw failure;
  }
  if (teardown.length > 0) {
    throw new AggregateError(teardown, "web-plane teardown failed");
  }
  return result as T;
}

/**
 * Dismiss whatever first-run dialog the host shows, until the page stays clear.
 * The host mounts its notices a moment after the shell, so this waits for the
 * dialog condition itself rather than for a fixed time.
 */
async function dismissFirstRunDialogs(page: Page): Promise<void> {
  const dialog = page.locator("[role=dialog],[role=alertdialog]");
  for (let round = 0; round < 6; round += 1) {
    try {
      await dialog.first().waitFor({ state: "visible", timeout: round === 0 ? 4_000 : 1_500 });
    } catch {
      return;
    }
    const dismiss = dialog
      .first()
      .getByRole("button", { name: /^(close|continue|got it|dismiss|i understand)$/i });
    if ((await dismiss.count()) === 0) {
      throw new Error(
        `the host showed a dialog this helper does not know how to dismiss: ${String(await dialog.first().textContent())}`,
      );
    }
    await dismiss.first().click({ timeout: 5_000 });
    await dialog
      .first()
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => undefined);
  }
}

/** Load the page and wait for the host shell. */
export async function loadPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page
    .getByRole("button", { name: "Account menu" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await dismissFirstRunDialogs(page);
}

/** Open the host's Settings sheet from its account menu in a loaded page. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 });
  await page.getByRole("menuitem", { name: "Settings" }).first().click({ timeout: 10_000 });
  await page.locator("[role=dialog]").first().waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Open the Settings sheet and then the section the host's own settings navigation
 * lists under `label`. Fails loudly when the navigation has no such entry.
 */
export async function openSettingsSection(
  page: Page,
  url: string,
  label: string,
  sectionSelector: string,
): Promise<void> {
  await loadPage(page, url);
  await openSettings(page);
  const nav = page
    .locator("[role=dialog]")
    .first()
    .locator("button,[role=tab]")
    .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
  try {
    await nav.first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new Error(`the host's settings navigation lists no "${label}" entry`);
  }
  await nav.first().click({ timeout: 10_000 });
  await page.locator(sectionSelector).waitFor({ state: "visible", timeout: 20_000 });
}

/** The live composer's editable surface. */
export function composerEditor(page: Page) {
  return page.locator('div[contenteditable="true"]').first();
}

/**
 * Type `text` into the live composer and submit it. A slash command first opens
 * the host's command menu, whose Enter completes the command, so submission is
 * repeated until the composer has taken the draft.
 */
export async function submitComposer(page: Page, text: string): Promise<void> {
  const editor = composerEditor(page);
  await editor.click({ timeout: 10_000 });
  await page.keyboard.type(text);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Enter");
    try {
      await page.waitForFunction(
        `(document.querySelector('div[contenteditable="true"]')?.textContent ?? "").trim() === ""`,
        undefined,
        { timeout: 3_000 },
      );
      return;
    } catch {
      // The menu consumed this Enter; submit again.
    }
  }
  throw new Error(`the host composer never accepted "${text}"`);
}

/**
 * Load the page and open a session in `workspace` through the host's own workspace
 * picker, so the composer is the live host composer. Resolves once the editable
 * composer surface is visible.
 */
export async function openLiveSession(page: Page, url: string, workspace: string): Promise<void> {
  await loadPage(page, url);
  const name = workspace.slice(workspace.lastIndexOf("/") + 1);
  const editor = page.locator('div[contenteditable="true"]').first();
  const row = page.getByRole("button", { name, exact: true }).first();
  await page
    .getByRole("button", { name: /choose workspace/i })
    .first()
    .click({ timeout: 15_000 });
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await row.click({ timeout: 10_000 });
  // Picking a row either opens the session directly or arms the picker's "Open"
  // button, depending on the picker the host composed.
  const open = page.locator("[role=dialog]").getByRole("button", { name: "Open", exact: true });
  await Promise.race([
    editor.waitFor({ state: "visible", timeout: 30_000 }),
    open
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(async () => {
        await open.first().click({ timeout: 10_000 });
      }),
  ]);
  await editor.waitFor({ state: "visible", timeout: 30_000 });
}
