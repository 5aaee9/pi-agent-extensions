/**
 * Shared helper for driving this package's client half through the real Harness web
 * plane (`docs/conventions.md`, "real-plane contract"; AGENTS.md rule 5).
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
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const requireFromHere = createRequire(import.meta.url);

export interface WebPlane {
  readonly home: string;
  /** The authenticated page URL; it carries the host token, so never print it. */
  readonly pageUrl: string;
  /** The real workspace directory this plane opened a session in. */
  readonly workspace: string;
  close(): Promise<void>;
}

/** Resolve the CLI script a host package ships. */
function hostCli(): string {
  return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
}

/** Install each source into a throwaway web profile the way the Harness does. */
function installIntoProfile(home: string, sources: readonly string[]): void {
  for (const source of sources) {
    const result = spawnSync(
      process.execPath,
      [hostCli(), "plugin", "--profile", "web", "add", source],
      {
        env: { ...process.env, DSH_HOME: home },
        encoding: "utf8",
        timeout: 180_000,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `the host refused to install ${source}:\n${(result.stderr || result.stdout || (result.error?.message ?? "")).trim()}`,
      );
    }
  }
}

/** Boot `dsh web` on a free port and wait until it reports its authenticated URL. */
async function startWebServer(
  home: string,
  timeoutMs: number,
): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [hostCli(), "web", "--no-open", "--port", "0"], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dsh web did not report a URL within ${String(timeoutMs)} ms:\n${buffer}`));
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
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/**
 * Install `sources` into a throwaway web profile and boot the real web app. The
 * workspace directory is a real directory in the user's home so the host's own
 * workspace picker lists and opens it; the caller owns the plane and must close it.
 */
export async function openWebPlane(
  sources: readonly string[],
  timeoutMs = 120_000,
): Promise<WebPlane> {
  const home = mkdtempSync(join(tmpdir(), "dsh-web-plane-"));
  const workspace = mkdtempSync(join(homedir(), "dsh-ps-session-"));
  let child: ChildProcess | undefined;
  try {
    installIntoProfile(home, sources);
    const started = await startWebServer(home, timeoutMs);
    child = started.child;
    return {
      home,
      workspace,
      pageUrl: started.url,
      close: async () => {
        if (child !== undefined) await stopServer(child);
        rmSync(home, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child !== undefined) await stopServer(child);
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

/** Launch the real Chromium the pinned Playwright provisioned. */
export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch();
}

/**
 * Dismiss the host's first-run dialogs. They mount a moment after the shell and
 * reappear after a reload, so dismiss in rounds and only stop once two consecutive
 * rounds find none.
 */
async function dismissFirstRunDialogs(page: Page): Promise<void> {
  let clear = 0;
  for (let round = 0; round < 12 && clear < 2; round += 1) {
    const closed = await page.evaluate(`(() => {
      const dialog = document.querySelector("[role=dialog],[role=alertdialog]");
      if (dialog === null) return "none";
      const button = [...dialog.querySelectorAll("button")].find((element) =>
        /close|continue|got it|accept|dismiss/i.test(
          (element.textContent ?? "") + " " + (element.getAttribute("aria-label") ?? ""),
        ),
      );
      if (button === undefined) return "no-dismiss-button";
      button.click();
      return "dismissed";
    })()`);
    if (closed === "none") {
      clear += 1;
      await page.waitForTimeout(900);
      continue;
    }
    clear = 0;
    await page.waitForTimeout(900);
  }
}

async function loadPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page
    .getByRole("button", { name: "Account menu" })
    .waitFor({ state: "attached", timeout: 30_000 });
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
  await openSettingsWhileLoaded(page, waitSelector);
}

/**
 * Reopen the Settings sheet in an already loaded page (for example after a reload,
 * where the host shows its first-run dialog again). The row only mounts when the
 * sheet mounts, so the wait selector is the package's own root.
 */
export async function reopenSettingsSheet(page: Page, waitSelector: string): Promise<void> {
  await dismissFirstRunDialogs(page);
  await openSettingsWhileLoaded(page, waitSelector);
}

async function openSettingsWhileLoaded(page: Page, waitSelector: string): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("menuitem", { name: "Settings" }).first().click({ timeout: 8_000 });
  await page.locator(waitSelector).waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1200);
}

/**
 * Load the page and open a session in `workspace` through the host's own workspace
 * picker, so the composer (and this package's `conversation.input.overlay` slot) is
 * the live host composer rather than a stand-in. Resolves once the editable composer
 * surface is attached.
 */
export async function openLiveSession(page: Page, url: string, workspace: string): Promise<void> {
  await loadPage(page, url);
  const name = workspace.slice(workspace.lastIndexOf("/") + 1);
  await chooseWorkspace(page, name);
  await page.locator('div[contenteditable="true"]').first().waitFor({
    state: "attached",
    timeout: 30_000,
  });
  await page.waitForTimeout(3000);
}

/**
 * Click through the host's workspace picker. The host mounts its "Preview Notice"
 * modal a few seconds after the shell and again after a reload, and that modal
 * intercepts pointer events, so this polls: it dismisses any modal that appears over
 * the picker and retries the picker button instead of failing on one timed-out click.
 */
async function chooseWorkspace(page: Page, name: string): Promise<void> {
  let picked = false;
  for (let attempt = 0; attempt < 40 && !picked; attempt += 1) {
    const state = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll("button")].filter(
        (element) => (element.textContent ?? "").trim() === ${JSON.stringify(name)},
      );
      if (rows.length > 0) {
        rows[0].click();
        return "picked";
      }
      const dialog = document.querySelector("[role=dialog],[role=alertdialog]");
      if (dialog === null) {
        const trigger = [...document.querySelectorAll("button")].find((element) =>
          /choose workspace/i.test(
            (element.textContent ?? "") + " " + (element.getAttribute("aria-label") ?? ""),
          ),
        );
        if (trigger === undefined) return "no-trigger";
        trigger.click();
        return "opened";
      }
      const dismiss = [...dialog.querySelectorAll("button")].find((element) =>
        /continue|close|got it|accept|dismiss/i.test(
          (element.textContent ?? "") + " " + (element.getAttribute("aria-label") ?? ""),
        ),
      );
      if (dismiss === undefined) return "modal";
      dismiss.click();
      return "dismissed";
    })()`);
    if (state === "picked") {
      picked = true;
      break;
    }
    await page.waitForTimeout(600);
  }
  if (!picked) throw new Error(`the host's workspace picker never listed ${name}`);
  await page.waitForTimeout(1200);
  // Picking a row either opens the session directly or arms the picker's "Open"
  // button, depending on whether the host already has a session for that workspace,
  // so poll for whichever the live page does.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await page.evaluate(`(() => {
      if (document.querySelector('[contenteditable="true"]') !== null) return "ready";
      const dialog = document.querySelector("[role=dialog],[role=alertdialog]");
      if (dialog === null) return "no-dialog";
      const open = [...dialog.querySelectorAll("button")].find(
        (element) => (element.textContent ?? "").trim() === "Open",
      );
      if (open === undefined) return "waits";
      open.click();
      return "opened";
    })()`);
    if (state === "ready") return;
    await page.waitForTimeout(600);
  }
  throw new Error("the host never attached the composer after picking a workspace");
}
