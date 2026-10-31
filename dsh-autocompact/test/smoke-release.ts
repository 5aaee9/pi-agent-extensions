/**
 * Release smoke check for `@indexyz/dsh-autocompact`.
 *
 * The release engine packs this package, installs the tarball into an empty
 * directory, and runs `node test/smoke-release.ts <installed-package-dir>`. The
 * first half checks the *installed* copy with Node built-ins: every file `main`,
 * `types`, `exports` and the dsh bundle patch promise, plus the built Host and
 * client entries. The second half then runs the client half where it actually runs:
 * the installed package is installed into a throwaway profile, the pinned host's
 * real `dsh web` server boots, a real Chromium opens the Settings sheet, and the
 * assertions observe what the host's own navigation, section slot, settings service
 * and locale rendered. No stand-in for the host, its DOM, its loader or its services
 * is involved.
 *
 * Usage: `node test/smoke-release.ts <installed-package-dir>`. The host CLI and
 * Playwright come from this package's devDependencies, so the script runs from the
 * worktree that packed the tarball, against the installed copy.
 */

import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Page } from "playwright";

import { launchBrowser, openSettingsSection, openWebPlane, withTeardown } from "./web-plane.ts";

/** The module id the client artifact must register. */
const PACKAGE_ID = "@indexyz/dsh-autocompact";
const SECTION = "section.dsha-page";

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be an object`,
  );
  return value as Record<string, unknown>;
}

function insidePackage(dir: string, path: string, field: string): void {
  const fromPackage = relative(dir, path);
  assert.ok(
    fromPackage !== "" &&
      fromPackage !== ".." &&
      !fromPackage.startsWith(`..${sep}`) &&
      !isAbsolute(fromPackage),
    `${field} must point to a file inside the installed package`,
  );
}

function packagedPath(dir: string, value: unknown, field: string): string {
  assert.ok(
    typeof value === "string" && value.trim() !== "" && !isAbsolute(value),
    `${field} must declare a package-relative file path`,
  );
  const path = resolve(dir, value);
  insidePackage(dir, path, field);
  assert.ok(statSync(path).isFile(), `${field} must point to a file: ${value}`);
  insidePackage(dir, realpathSync(path), field);
  return path;
}

function exportTargets(value: unknown, field = "exports"): string[] {
  if (typeof value === "string") return [value];
  if (value === null) return [];
  assert.ok(typeof value === "object" && value !== undefined, `${field} is invalid`);
  return Object.entries(value).flatMap(([key, nested]: [string, unknown]) =>
    exportTargets(nested, `${field}.${key}`),
  );
}

/** What the host rendered for this package's section, from the live document. */
const RENDERED_SECTION = `(() => {
  const root = document.querySelector("section.dsha-page");
  if (root === null) return null;
  const toggle = root.querySelector("[role=switch]");
  const defaultLimit = [...root.querySelectorAll("input")].find(
    (element) => element.getAttribute("aria-label") === "Default threshold",
  );
  return JSON.stringify({
    pages: document.querySelectorAll("section.dsha-page").length,
    title: root.querySelector(".dsha-title")?.textContent?.trim() ?? "",
    intro: root.querySelector(".dsha-intro")?.textContent?.trim() ?? "",
    switchChecked: toggle?.getAttribute("aria-checked") ?? "",
    switchClass: String(toggle?.className ?? ""),
    defaultLimit: defaultLimit?.value ?? "",
    styleLength: (root.querySelector("style")?.textContent ?? "").length,
  });
})()`;

/** Wait until a locator reports the settled copy instead of a transient state. */
async function waitForText(
  locator: { textContent(): Promise<string | null> },
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = (await locator.textContent())?.trim();
    if (current === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`the host never showed "${expected}" (last: ${String(current)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/**
 * Open the installed package's section through the host's own settings navigation,
 * which is the entry the section slot registers into.
 */
async function openSection(page: Page, url: string): Promise<void> {
  await openSettingsSection(page, url, "Autocompact", SECTION);
  await page.locator(`${SECTION} [role=switch]`).waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * Load the installed package in the real host plane and assert what the host's own
 * Settings surface rendered for it and what its settings service accepted.
 */
async function checkRenderedClient(installed: string): Promise<void> {
  const plane = await openWebPlane({ sources: [installed] });
  const browser = await launchBrowser().catch(async (error: unknown) => {
    await plane.close();
    throw error;
  });
  await withTeardown(async () => {
    const first = await browser.newContext();
    const page = await first.newPage();
    await openSection(page, plane.pageUrl);

    const raw: unknown = await page.evaluate(RENDERED_SECTION);
    assert.ok(raw !== null, "the host did not mount this package's settings section");
    const view = JSON.parse(String(raw)) as {
      pages: number;
      title: string;
      intro: string;
      switchChecked: string;
      switchClass: string;
      defaultLimit: string;
      styleLength: number;
    };
    assert.equal(view.pages, 1, "the host must mount exactly one section");
    assert.equal(view.title, "Autocompact", "English title from the registered locale");
    assert.equal(
      view.intro,
      "Compact a session earlier than the backend default, per model or with a default.",
      "section intro from the registered locale",
    );
    assert.equal(view.switchClass, "dsha-switch", "the section's own switch control");
    assert.equal(view.switchChecked, "true", "a freshly installed package starts enabled");
    assert.equal(view.defaultLimit, "", "a fresh profile has no deployment threshold");
    assert.ok(view.styleLength > 0, "the section must ship its own styles");

    // The page must write through the host's real settings service and be read
    // back by a second page, which is what the host's storage really guarantees.
    await page.locator(`${SECTION} [role=switch]`).first().click({ timeout: 8_000 });
    await page.waitForFunction(
      `document.querySelector("section.dsha-page [role=switch]")?.getAttribute("aria-checked") === "false"`,
      undefined,
      { timeout: 20_000 },
    );
    await page.locator(`${SECTION} input[aria-label="Default threshold"]`).first().fill("300k");
    await page.locator(`${SECTION} button`, { hasText: "Save" }).first().click({ timeout: 8_000 });
    await waitForText(page.locator(`${SECTION} [role=status]`).first(), "Saved.", 20_000);
    await first.close();

    const fresh = await browser.newContext();
    try {
      const freshPage = await fresh.newPage();
      await openSection(freshPage, plane.pageUrl);
      const readBack = JSON.parse(
        String((await freshPage.evaluate(RENDERED_SECTION)) as unknown),
      ) as { switchChecked: string; defaultLimit: string };
      assert.equal(readBack.switchChecked, "false", "the switch write persisted for a new page");
      assert.equal(readBack.defaultLimit, "300000", "the saved threshold persisted for a new page");
    } finally {
      await fresh.close();
    }
  }, [async () => await browser.close(), async () => await plane.close()]);
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  assert.ok(
    process.argv.length === 3 && argument !== undefined && argument.trim() !== "",
    "usage: node test/smoke-release.ts <installed-package-dir>",
  );
  const installed = realpathSync(resolve(argument));
  assert.ok(statSync(installed).isDirectory(), "installed package path must be a directory");
  const parsed: unknown = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const manifest = object(parsed, "package.json");
  assert.equal(manifest["name"], PACKAGE_ID, "installed package name");
  const dsh = object(manifest["dsh"], "dsh manifest");
  const client = object(dsh["client"], "dsh.client manifest");
  assert.equal(client["platform"], "web", "the client half targets the web platform");
  const inject = client["inject"];
  assert.ok(Array.isArray(inject), "dsh.client.inject must be a list");
  assert.ok(
    inject.includes("@deepseek-ai/dsh-client-ui-settings"),
    "dsh.client.inject must include the settings surface package the section mounts through",
  );
  packagedPath(installed, manifest["main"], "main");
  packagedPath(installed, manifest["types"], "types");
  const targets = exportTargets(manifest["exports"]);
  assert.ok(targets.length > 0, "package.json must declare exports targets");
  for (const target of targets) packagedPath(installed, target, "exports");
  const bundle = object(dsh["bundle"], "dsh.bundle manifest");
  packagedPath(installed, bundle["patch"], "dsh.bundle.patch");
  packagedPath(installed, "lib/index.js", "built host entry");
  packagedPath(installed, "client.js", "built client entry");
  await checkRenderedClient(installed);
  console.log(
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch files, installed package rendered in the real host plane, toggled and saved through the settings service, persisted across pages)`,
  );
}

main().catch((error: unknown) => {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
