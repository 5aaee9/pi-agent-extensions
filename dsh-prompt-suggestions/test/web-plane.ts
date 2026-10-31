/**
 * Shared helper for driving this package's client half through the real Harness web
 * plane (`docs/conventions.md`, "Tests"; AGENTS.md rule 5).
 *
 * It starts the pinned host CLI (`@deepseek-ai/dsh`, a devDependency pinned to the
 * host version this package builds against) as a real `dsh web` server over a
 * throwaway `DSH_HOME`, installs *this* package into the host's web profile exactly
 * the way the Harness installs any plugin (`dsh plugin --profile web add`), picks a
 * real workspace directory through the host's own picker, and drives the served page
 * with a real Chromium browser. Nothing here replaces a host module: the slot
 * registry, locale service, settings service, session store, and UI primitives all
 * come from the running host, and every assertion runs against the DOM the host
 * itself renders.
 *
 * The server child runs with `HOME` pointed at a directory inside the throwaway
 * home, so the host's workspace picker (which lists the process home) offers the
 * plane's workspace without the test touching the real user home.
 *
 * Every spawned process is started in its own process group and tracked until it
 * exits; a startup failure or timeout kills its group before rejecting, and a
 * process `exit` hook kills any group still alive, so neither a failed `beforeAll`
 * nor an interrupted run can leave a `dsh web` server behind.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const requireFromHere = createRequire(import.meta.url);

/** Children still alive, killed by group on process exit. */
const live = new Set<ChildProcess>();

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

process.once("exit", () => {
  for (const child of live) killGroup(child, "SIGKILL");
});

/** Spawn in a fresh process group and track the child until it exits. */
function spawnTracked(args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  live.add(child);
  child.once("exit", () => live.delete(child));
  return child;
}

async function stopChild(child: ChildProcess, graceMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    live.delete(child);
    return;
  }
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

export interface WebPlane {
  readonly home: string;
  /** The authenticated page URL; it carries the host token, so never print it. */
  readonly pageUrl: string;
  /** The real workspace directory this plane opens sessions in. */
  readonly workspace: string;
  /** Create another workspace directory the host's picker lists, for a fresh session. */
  addWorkspace(name: string): string;
  close(): Promise<void>;
}

export interface WebPlaneOptions {
  /** Extra rows appended to the profile's own `cordis.patch.yml`. */
  readonly patch?: string;
  /** Extra environment for the server process. */
  readonly env?: Readonly<Record<string, string>>;
  /** Startup budget for install plus server boot. */
  readonly timeoutMs?: number;
}

/** Resolve the CLI script a host package ships. */
function hostCli(): string {
  return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
}

/** Every file under `path` (a file or a directory), relative to `root`. */
function filesUnder(root: string, path: string): string[] {
  if (!statSync(join(root, path)).isDirectory()) return [path];
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(root, join(path, entry.name)) : [join(path, entry.name)],
  );
}

/**
 * Fail fast when `client.js` or `lib/` is missing or older than the sources they
 * are built from: the plane installs the package directory as it sits on disk, so
 * a stale artifact would be tested instead of the current code.
 */
export function assertFreshBuild(packageDir: string): void {
  let built: number;
  try {
    built = Math.min(
      statSync(join(packageDir, "client.js")).mtimeMs,
      statSync(join(packageDir, "lib", "index.js")).mtimeMs,
    );
  } catch {
    throw new Error(`${packageDir} has no build output; run \`npm run build\` first`);
  }
  const sources = ["index.ts", "src"].flatMap((path) => filesUnder(packageDir, path));
  const stale = sources.filter((path) => statSync(join(packageDir, path)).mtimeMs > built);
  if (stale.length > 0) {
    throw new Error(
      `${packageDir}'s client.js or lib/ is older than ${stale.join(", ")}; run \`npm run build\` first`,
    );
  }
}

/** Run one host CLI command to completion, killing its group on timeout. */
async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const child = spawnTracked([hostCli(), ...args], env);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      killGroup(child, "SIGKILL");
      reject(new Error(`dsh ${args.join(" ")} did not finish within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(new Error(`dsh ${args.join(" ")} exited with ${String(code)}:\n${output.trim()}`));
    });
  });
}

/** Boot `dsh web` on a free port and wait until it reports its authenticated URL. */
async function startWebServer(child: ChildProcess, timeoutMs: number): Promise<string> {
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
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        // Keep draining so a chatty server never blocks on a full pipe.
        child.stdout?.resume();
        child.stderr?.resume();
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
 * Install `sources` into a throwaway web profile and boot the real web app. The
 * returned plane owns the server process and the throwaway home; `close` stops the
 * server and removes the home.
 */
export async function openWebPlane(
  sources: readonly string[],
  options: WebPlaneOptions = {},
): Promise<WebPlane> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const home = mkdtempSync(join(tmpdir(), "dsh-web-plane-"));
  const userHome = join(home, "user");
  const workspace = join(userHome, "dsh-ps-session");
  mkdirSync(workspace, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, DSH_HOME: home, HOME: userHome };
  let child: ChildProcess | undefined;
  const close = async (): Promise<void> => {
    if (child !== undefined) await stopChild(child);
    rmSync(home, { recursive: true, force: true });
  };
  try {
    for (const source of sources) {
      await runCli(["plugin", "--profile", "web", "add", source], env, timeoutMs);
    }
    if (options.patch !== undefined) {
      const file = join(home, "profiles", "web", "cordis.patch.yml");
      writeFileSync(file, options.patch);
    }
    child = spawnTracked([hostCli(), "web", "--no-open", "--port", "0"], env);
    const pageUrl = await startWebServer(child, timeoutMs);
    const addWorkspace = (name: string): string => {
      const path = join(userHome, name);
      mkdirSync(path, { recursive: true });
      return path;
    };
    return { home, workspace, pageUrl, addWorkspace, close };
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
 * The first-run dialogs the pinned host opens, each with the button that closes
 * it. Only these are answered; any other dialog fails the test with its text.
 */
const FIRST_RUN_DIALOGS: readonly { readonly title: RegExp; readonly button: string }[] = [
  { title: /^Preview Notice/u, button: "Continue" },
];

/**
 * Dismiss the host's first-run dialogs. The host mounts them a moment after the
 * shell, so wait until no dialog appears for a quiet window and close each known
 * one through its own button.
 */
async function dismissFirstRunDialogs(
  page: Page,
  quietMs = 2_500,
  budgetMs = 30_000,
): Promise<void> {
  const dialogs = page.locator("[role=dialog],[role=alertdialog]");
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const appeared = await dialogs
      .first()
      .waitFor({ state: "visible", timeout: quietMs })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;
    const dialog = dialogs.first();
    const text = ((await dialog.textContent()) ?? "").trim();
    const known = FIRST_RUN_DIALOGS.find((entry) => entry.title.test(text));
    if (known === undefined) throw new Error(`unexpected host dialog: ${text.slice(0, 200)}`);
    await dialog.getByRole("button", { name: known.button, exact: true }).click({ timeout: 5_000 });
    await dialog.waitFor({ state: "detached", timeout: 5_000 });
  }
  throw new Error("the host kept opening dialogs");
}

/** Credential reference the local model route resolves through the host's credentials. */
export const LOCAL_KEY_REF = "PROMPT_SUGGESTIONS_LOCAL_KEY";

/**
 * Profile patch rows that point the host's own `llm-pi-ai` adapter at a locally
 * started OpenAI-compatible endpoint and select its model as the default for new
 * sessions, the same rows the web Models page and model picker would persist.
 * @param baseURL - the local endpoint's base URL.
 * @returns YAML for the profile's `cordis.patch.yml`.
 */
export function localModelPatch(baseURL: string): string {
  return `- id: llm-pi-ai
  config:
    providers:
      local:
        displayName: Local endpoint
        api: openai-completions
        baseURL: ${JSON.stringify(baseURL)}
        apiKeyEnv: ${LOCAL_KEY_REF}
        retryPolicy: { mode: normal, maxRetries: 0 }
        models:
          - id: local-model
            reasoningEfforts: { off: null, low: low, high: high }
- id: agent-default-model
  config:
    provider: local
    model: local-model
`;
}

/** Load the page and wait for the host shell, then clear first-run dialogs. */
export async function loadPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page
    .getByRole("button", { name: "Account menu" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await dismissFirstRunDialogs(page);
}

/**
 * Load the page, dismiss first-run dialogs, and open the host's Settings sheet.
 * The wait selector is this package's own rendered root: the host mounts the row
 * through the real `settings.general.item` slot, so it only appears when the client
 * module loaded, applied, and rendered in the live page.
 */
export async function openSettingsSheet(
  page: Page,
  url: string,
  waitSelector: string,
): Promise<void> {
  await loadPage(page, url);
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 });
  const item = page.getByRole("menuitem", { name: "Settings" }).first();
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await item.click({ timeout: 8_000 });
  await page.locator(waitSelector).waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Load the page and open a session in `workspace` through the host's own workspace
 * picker, so the composer (and this package's `conversation.input.overlay` slot) is
 * the live host composer rather than a stand-in. Resolves once the editable composer
 * surface and this package's anchor are attached.
 */
export async function openLiveSession(page: Page, url: string, workspace: string): Promise<void> {
  await loadPage(page, url);
  const name = workspace.slice(workspace.lastIndexOf("/") + 1);
  const composer = page.locator('div[contenteditable="true"]').first();
  if (!(await composer.isVisible())) {
    await page
      .getByRole("button", { name: /choose workspace/iu })
      .first()
      .click({ timeout: 15_000 });
    await page.getByRole("button", { name, exact: true }).first().click({ timeout: 15_000 });
    // Picking a row either opens the session directly or arms the picker's "Open"
    // button, depending on whether the host already has a session there.
    const open = page.getByRole("dialog").getByRole("button", { name: "Open", exact: true });
    await Promise.race([
      composer.waitFor({ state: "visible", timeout: 30_000 }),
      open.click({ timeout: 30_000 }).catch(() => undefined),
    ]);
  }
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("[data-prompt-suggestions-anchor]").waitFor({
    state: "attached",
    timeout: 30_000,
  });
}
