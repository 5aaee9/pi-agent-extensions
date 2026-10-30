/**
 * Shared helper for driving this package's client half through the real Harness web
 * plane (`docs/conventions.md`, "real-plane contract"; AGENTS.md rule 5).
 *
 * It starts the pinned host CLI (`@deepseek-ai/dsh`, a devDependency pinned to the
 * host version this package builds against) as a real `dsh web` server over a
 * throwaway `DSH_HOME`, installs *this* package into the host's web profile exactly
 * the way the Harness installs any plugin (`dsh plugin --profile web add`), and drives
 * the served page with a real Chromium browser. Nothing here replaces a host module:
 * the slot registry, locale service, settings service, session model catalog, and UI
 * primitives all come from the running host, and every assertion runs against the DOM
 * the host itself renders.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const requireFromHere = createRequire(import.meta.url);

export interface WebPlane {
  readonly home: string;
  /** The authenticated page URL; it carries the host token, so never print it. */
  readonly pageUrl: string;
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
 * caller owns the plane and must close it.
 */
export async function openWebPlane(
  sources: readonly string[],
  timeoutMs = 120_000,
): Promise<WebPlane> {
  const home = mkdtempSync(join(tmpdir(), "dsh-web-plane-"));
  let child: ChildProcess | undefined;
  try {
    installIntoProfile(home, sources);
    const started = await startWebServer(home, timeoutMs);
    child = started.child;
    return {
      home,
      pageUrl: started.url,
      close: async () => {
        if (child !== undefined) await stopServer(child);
        rmSync(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child !== undefined) await stopServer(child);
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

/** Launch the real Chromium the pinned Playwright provisioned. */
export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch();
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
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await openSettingsWhileDismissing(page, waitSelector);
}

/**
 * Reopen the Settings sheet in an already loaded page (for example after a reload,
 * where the host shows its first-run dialog again). The row only mounts when the
 * sheet mounts, so the wait selector is the package's own root.
 */
export async function reopenSettingsSheet(page: Page, waitSelector: string): Promise<void> {
  await openSettingsWhileDismissing(page, waitSelector);
}

async function openSettingsWhileDismissing(page: Page, waitSelector: string): Promise<void> {
  await page
    .getByRole("button", { name: "Account menu" })
    .waitFor({ state: "attached", timeout: 30_000 });
  // First-run dialogs mount a moment after the shell and reappear after a reload, so
  // dismiss in rounds and only stop once two consecutive rounds find none.
  let clear = 0;
  for (let round = 0; round < 8 && clear < 2; round += 1) {
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
      await page.waitForTimeout(400);
      continue;
    }
    clear = 0;
    await page.waitForTimeout(900);
  }
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("menuitem", { name: "Settings" }).first().click({ timeout: 8_000 });
  await page.locator(waitSelector).waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1200);
}
