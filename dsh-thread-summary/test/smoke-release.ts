/**
 * Verify the installed tarball in its real environment.
 *
 * The first half checks the published artifact itself with Node built-ins: every
 * manifest entry must point at a real file inside the installed package. The
 * second half then runs the browser half where it actually runs: the installed
 * package is installed into a throwaway profile, the pinned host's real `dsh web`
 * server boots, a real Chromium loads the page the host built, and the assertions
 * observe what the host's own services and primitives rendered. Nothing about the
 * host, its settings service, its UI, or its DOM is replaced by a stand-in.
 *
 * Usage: `node test/smoke-release.ts <installed-package-dir>`. The host CLI and
 * Playwright come from this package's devDependencies, so the script runs from
 * the worktree that packed the tarball, against the installed copy.
 */
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { launchBrowser, openSettingsSheet, openWebPlane } from "./web-plane.ts";

const PACKAGE_ID = "@indexyz/dsh-thread-summary";
const SETTINGS_SLOT = "settings.general.item";
const NAMESPACE = "thread-summary";
const ROW_SELECTOR = "section.dsh-thread-summary";

type UnknownFunction = (...args: unknown[]) => unknown;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be an object`,
  );
  return value as Record<string, unknown>;
}

function callable(value: unknown, description: string): UnknownFunction {
  assert.equal(typeof value, "function", `${description} must be a function`);
  return value as UnknownFunction;
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

interface RenderedRow {
  readonly rows: number;
  readonly title: string;
  readonly description: string;
  readonly switchChecked: string;
  readonly switchClass: string;
  readonly saveClass: string;
  readonly styleLength: number;
}

/** What the host rendered for this package, read from the live document. */
const RENDERED_ROW = `(() => {
  const root = document.querySelector("section.dsh-thread-summary");
  if (root === null) return null;
  const switchElement = root.querySelector("[role=switch]");
  const save = root.querySelector("button.dsh-summary-save");
  return JSON.stringify({
    rows: document.querySelectorAll("section.dsh-thread-summary").length,
    title: root.querySelector("h3.dsh-summary-title")?.textContent ?? "",
    description: root.querySelector("p.dsh-summary-description")?.textContent ?? "",
    switchChecked: switchElement?.getAttribute("aria-checked") ?? "",
    switchClass: switchElement?.className ?? "",
    saveClass: save?.className ?? "",
    styleLength: (root.querySelector("style")?.textContent ?? "").length,
  });
})()`;

/**
 * Load the installed package in the real host plane and assert what the host's
 * own Settings surface rendered for it.
 */
async function checkRenderedClient(installed: string): Promise<void> {
  const plane = await openWebPlane([installed]);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await openSettingsSheet(page, plane.pageUrl, ROW_SELECTOR);

    const raw: unknown = await page.evaluate(RENDERED_ROW);
    assert.ok(raw !== null, "the host did not render this package's General settings row");
    const row = JSON.parse(String(raw)) as RenderedRow;
    assert.equal(row.rows, 1, "the host must mount exactly one settings row");
    assert.equal(row.title, "Summary model", "English row title from the registered locale");
    assert.equal(
      row.description,
      "Name new sessions from your first message.",
      "row description from the registered locale",
    );
    assert.ok(row.styleLength > 0, "the row must ship its own styles");
    assert.match(row.switchClass, /_switch_[0-9a-z]+_[0-9a-z]+/, "host Switch primitive");
    assert.match(row.saveClass, /_button_[0-9a-z]+_[0-9a-z]+/, "host Button primitive");
    assert.equal(row.switchChecked, "true", "a freshly installed package starts enabled");

    // The row must write through the host's real settings service and be read
    // back by a second page, which is what the host's storage really guarantees.
    await page.locator(`${ROW_SELECTOR} [role=switch]`).first().click({ timeout: 8_000 });
    await page.locator(`${ROW_SELECTOR} button.dsh-summary-save`).first().click({ timeout: 8_000 });
    const status = page.locator(`${ROW_SELECTOR} .dsh-summary-status[data-tone]`).first();
    await status.waitFor({ state: "attached", timeout: 8_000 });
    assert.equal((await status.textContent())?.trim(), "Saved", "save feedback from the service");
    assert.equal(await status.getAttribute("data-tone"), "success", "success feedback tone");

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await openSettingsSheet(freshPage, plane.pageUrl, ROW_SELECTOR);
    assert.equal(
      await freshPage.locator(`${ROW_SELECTOR} [role=switch]`).first().getAttribute("aria-checked"),
      "false",
      "the write persisted for a new page",
    );
    await fresh.close();
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    await plane.close().catch(() => {});
  }
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
  packagedPath(installed, manifest["main"], "main");
  packagedPath(installed, manifest["types"], "types");
  const targets = exportTargets(manifest["exports"]);
  assert.ok(targets.length > 0, "package.json must declare exports targets");
  for (const target of targets) packagedPath(installed, target, "exports");
  const dsh = object(manifest["dsh"], "dsh manifest");
  const bundle = object(dsh["bundle"], "dsh.bundle manifest");
  packagedPath(installed, bundle["patch"], "dsh.bundle.patch");
  packagedPath(installed, "lib/index.js", "built host entry");
  packagedPath(installed, "client.js", "built client entry");
  await checkRenderedClient(installed);
  console.log(
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch files, installed package rendered in the real host plane, saved through the settings service, persisted across pages)`,
  );
}

main().catch((error: unknown) => {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
