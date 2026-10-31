/**
 * Verify the installed tarball in its real environment.
 *
 * The first half checks the published artifact itself with Node built-ins: every
 * manifest entry must point at a real file inside the installed package. The second
 * half then runs both browser halves where they actually run: the installed package
 * is installed into a throwaway profile, the pinned host's real `dsh web` server
 * boots, a real Chromium loads the page the host built, and the assertions observe
 * what the host's own services, slot registry, composer and primitives rendered.
 * Nothing about the host, its settings service, its UI, or its DOM is replaced by a
 * stand-in.
 *
 * Usage: `node test/smoke-release.ts <installed-package-dir>`. The host CLI and
 * Playwright come from this package's devDependencies, so the script runs from the
 * worktree that packed the tarball, against the installed copy.
 */
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { launchBrowser, openLiveSession, openSettingsSheet, openWebPlane } from "./web-plane.ts";

const PACKAGE_ID = "@indexyz/dsh-prompt-suggestions";
const SETTINGS_SLOT = "settings.general.item";
const ROW_SELECTOR = "section.dsh-prompt-suggestions";

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

interface RenderedRow {
  readonly rows: number;
  readonly title: string;
  readonly description: string;
  readonly hint: string;
  readonly switchChecked: string;
  readonly switchClass: string;
  readonly styleLength: number;
}

/** What the host rendered for this package's settings row, from the live document. */
const RENDERED_ROW = `(() => {
  const root = document.querySelector("section.dsh-prompt-suggestions");
  if (root === null) return null;
  const switchElement = root.querySelector("[role=switch]");
  const text = (selector) => root.querySelector(selector)?.textContent?.trim() ?? "";
  return JSON.stringify({
    rows: document.querySelectorAll("section.dsh-prompt-suggestions").length,
    title: text("h3.dsh-prompt-suggestions-title"),
    description: text(".dsh-prompt-suggestions-description"),
    hint: text(".dsh-prompt-suggestions-hint"),
    switchChecked: switchElement?.getAttribute("aria-checked") ?? "",
    switchClass: String(switchElement?.className ?? ""),
    styleLength: (root.querySelector("style")?.textContent ?? "").length,
  });
})()`;

/** What the host rendered for this package's composer overlay, from the live document. */
const RENDERED_OVERLAY = `(() => {
  const anchor = document.querySelector("[data-prompt-suggestions-anchor]");
  const card = anchor?.closest("[data-composer-card]") ?? null;
  const editor = card?.querySelector('[contenteditable="true"]') ?? null;
  const placeholder = card?.querySelector("[data-composer-placeholder]") ?? null;
  return JSON.stringify({
    anchors: document.querySelectorAll("[data-prompt-suggestions-anchor]").length,
    anchorLabel: anchor?.getAttribute("data-prompt-suggestions-anchor") ?? "",
    anchorHidden: anchor?.hasAttribute("hidden") ?? false,
    cardFound: card !== null,
    editorEditable: editor?.getAttribute("contenteditable") ?? "",
    placeholderText: placeholder?.textContent?.trim() ?? "",
    placeholderVisibility: placeholder === null ? "" : getComputedStyle(placeholder).visibility,
    ghosts: document.querySelectorAll("[data-prompt-suggestions]").length,
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
 * Load the installed package in the real host plane and assert what the host's own
 * Settings surface and live session rendered for it.
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
    assert.equal(row.title, "Next-message suggestions", "English row title from the locale");
    assert.equal(
      row.description,
      "Show a dim suggestion in the empty composer after a successful reply.",
      "row description from the registered locale",
    );
    assert.ok(row.hint.length > 0, "the row must show its hint while enabled");
    assert.ok(row.styleLength > 0, "the row must ship its own styles");
    assert.match(row.switchClass, /_switch_[0-9a-z]+_[0-9a-z]+/, "host Switch primitive");
    assert.equal(row.switchChecked, "true", "a freshly installed package starts enabled");

    // The row must write through the host's real settings service and be read back by
    // a second page, which is what the host's storage really guarantees. The toggle
    // writes immediately, so the settled copy is the service's own feedback.
    await page.locator(`${ROW_SELECTOR} [role=switch]`).first().click({ timeout: 8_000 });
    const status = page.locator(`${ROW_SELECTOR} [role=status][data-tone]`).first();
    await status.waitFor({ state: "attached", timeout: 15_000 });
    await waitForText(status, "Saved", 20_000);
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

    // The overlay half must mount in the host's own composer, not only in Settings.
    await openLiveSession(page, plane.pageUrl, plane.workspace);
    const overlayRaw: unknown = await page.evaluate(RENDERED_OVERLAY);
    const overlay = JSON.parse(String(overlayRaw)) as {
      anchors: number;
      anchorLabel: string;
      anchorHidden: boolean;
      cardFound: boolean;
      editorEditable: string;
      placeholderText: string;
      placeholderVisibility: string;
      ghosts: number;
    };
    assert.equal(overlay.anchors, 1, "the overlay slot must mount once in the live composer");
    assert.equal(
      overlay.anchorLabel,
      "Next-message suggestions",
      "the anchor carries the localized label",
    );
    assert.equal(overlay.anchorHidden, true, "the anchor itself stays inert");
    assert.equal(overlay.cardFound, true, "the overlay must find the host composer card");
    assert.equal(overlay.editorEditable, "true", "the host composer must be editable");
    assert.ok(overlay.placeholderText.length > 0, "the composer keeps its native placeholder");
    assert.equal(overlay.placeholderVisibility, "visible", "nothing is painted without a reply");
    assert.equal(overlay.ghosts, 0, "no ghost row exists before a suggestion is available");

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
  const dsh = object(manifest["dsh"], "dsh manifest");
  const client = object(dsh["client"], "dsh.client manifest");
  assert.equal(client["platform"], "web", "the client half targets the web platform");
  const inject = client["inject"];
  assert.ok(Array.isArray(inject), "dsh.client.inject must be a list");
  assert.ok(
    inject.includes("@deepseek-ai/dsh-client-ui-settings"),
    `dsh.client.inject must include the settings surface package that mounts ${SETTINGS_SLOT}`,
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
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch files, installed package rendered in the real host plane, toggled through the settings service and persisted across pages, overlay mounted in the live composer)`,
  );
}

main().catch((error: unknown) => {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
