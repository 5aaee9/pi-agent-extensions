/**
 * Verify the installed tarball in its real environment.
 *
 * The first half checks the published artifact itself with Node built-ins: every
 * manifest entry must point at a real file inside the installed package. The second
 * half then runs both halves where they actually run: the installed package is
 * installed into a throwaway profile, the pinned host's real `dsh web` server boots
 * with its own `llm-pi-ai` adapter pointed at a locally started endpoint, a real
 * Chromium loads the page the host built, a real turn completes, and the assertions
 * observe what the host's own services, slot registry, composer and primitives
 * rendered — including the suggestion the installed host half generated.
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

import type { Browser, Page } from "playwright";

import { DICT } from "../src/client/dictionary.ts";
import { SUGGESTION_INSTRUCTIONS } from "../src/host/constants.ts";
import { startModelServer } from "./model-server.ts";
import {
  launchBrowser,
  LOCAL_KEY_REF,
  localModelPatch,
  openLiveSession,
  openSettingsSheet,
  openWebPlane,
  type WebPlane,
} from "./web-plane.ts";

const PACKAGE_ID = "@indexyz/dsh-prompt-suggestions";
const SETTINGS_SLOT = "settings.general.item";
const ROW_SELECTOR = "section.dsh-prompt-suggestions";
const SUGGESTION = "Add a regression test";

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
  const switchElement = root?.querySelector("[role=switch]");
  const text = (selector) => root?.querySelector(selector)?.textContent?.trim() ?? "";
  return JSON.stringify({
    rows: document.querySelectorAll("section.dsh-prompt-suggestions").length,
    title: text("h3.dsh-prompt-suggestions-title"),
    description: text(".dsh-prompt-suggestions-description"),
    hint: text(".dsh-prompt-suggestions-hint"),
    switchChecked: switchElement?.getAttribute("aria-checked") ?? "",
    switchClass: String(switchElement?.className ?? ""),
    styleLength: (root?.querySelector("style")?.textContent ?? "").length,
  });
})()`;

/** What the host rendered for this package's composer overlay, from the live document. */
const RENDERED_OVERLAY = `(() => {
  const anchor = document.querySelector("[data-prompt-suggestions-anchor]");
  const card = anchor?.closest("[data-composer-card]") ?? null;
  const editor = card?.querySelector('[contenteditable="true"]') ?? null;
  const placeholder = card?.querySelector("[data-composer-placeholder]") ?? null;
  const ghost = [...document.querySelectorAll("[data-prompt-suggestions]")].find(
    (element) => element.isConnected && element.style.display !== "none",
  );
  return JSON.stringify({
    anchors: document.querySelectorAll("[data-prompt-suggestions-anchor]").length,
    anchorLabel: anchor?.getAttribute("data-prompt-suggestions-anchor") ?? "",
    anchorHidden: anchor?.hasAttribute("hidden") ?? false,
    cardFound: card !== null,
    editorEditable: editor?.getAttribute("contenteditable") ?? "",
    placeholderVisibility: placeholder === null ? "" : getComputedStyle(placeholder).visibility,
    ghostText: ghost?.firstElementChild?.textContent ?? "",
    draft: editor?.textContent ?? "",
  });
})()`;

interface RenderedOverlay {
  readonly anchors: number;
  readonly anchorLabel: string;
  readonly anchorHidden: boolean;
  readonly cardFound: boolean;
  readonly editorEditable: string;
  readonly placeholderVisibility: string;
  readonly ghostText: string;
  readonly draft: string;
}

async function readOverlay(page: Page): Promise<RenderedOverlay> {
  return JSON.parse(String(await page.evaluate(RENDERED_OVERLAY))) as RenderedOverlay;
}

/** Poll `read` until it returns `expected`, failing with `what` and the last value. */
async function until<T>(
  read: () => Promise<T>,
  expected: T,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await read();
  while (last !== expected) {
    if (Date.now() > deadline) throw new Error(`${what} (last: ${JSON.stringify(last)})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    last = await read();
  }
}

/** Open the Settings sheet, failing with a package-specific message when the row never mounts. */
async function openRow(page: Page, url: string): Promise<RenderedRow> {
  try {
    await openSettingsSheet(page, url, ROW_SELECTOR);
  } catch (error) {
    throw new Error(
      `the host did not render this package's General settings row: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await page
    .locator(`${ROW_SELECTOR}[aria-busy="false"]`)
    .waitFor({ state: "visible", timeout: 20_000 });
  return JSON.parse(String(await page.evaluate(RENDERED_ROW))) as RenderedRow;
}

/** Toggle the row's switch and return the settled status copy. */
async function toggle(page: Page): Promise<string> {
  await page.locator(`${ROW_SELECTOR} [role=switch]`).first().click({ timeout: 8_000 });
  await page
    .locator(`${ROW_SELECTOR}[aria-busy="false"]`)
    .waitFor({ state: "visible", timeout: 20_000 });
  return (await page.locator(`${ROW_SELECTOR} [role=status]`).first().textContent())?.trim() ?? "";
}

/**
 * Load the installed package in the real host plane and assert what the host's own
 * Settings surface and live session rendered for it, including one real suggestion
 * produced by the installed host half from a completed turn against a local
 * OpenAI-compatible endpoint wired through the host's own `llm-pi-ai` adapter.
 */
async function checkRenderedClient(installed: string): Promise<void> {
  const copy = DICT.en;
  const server = await startModelServer((exchange) => {
    const messages = exchange.request.body["messages"];
    const first = Array.isArray(messages) ? (messages[0] as { content?: unknown }) : undefined;
    const text = first?.content === SUGGESTION_INSTRUCTIONS ? SUGGESTION : "Done.";
    exchange.chunk({ role: "assistant", content: text });
    exchange.chunk({}, "stop");
    exchange.done();
  });
  let plane: WebPlane | undefined;
  let browser: Browser | undefined;
  try {
    plane = await openWebPlane([installed], {
      patch: localModelPatch(server.baseURL),
      env: { [LOCAL_KEY_REF]: "local-endpoint-key" },
    });
    browser = await launchBrowser();
    const page = await browser.newPage();
    const row = await openRow(page, plane.pageUrl);
    assert.equal(row.rows, 1, "the host must mount exactly one settings row");
    assert.equal(row.title, copy.label, "row title from the registered locale");
    assert.equal(row.description, copy.description, "row description from the registered locale");
    assert.equal(row.hint, copy.hint, "the row shows its enabled hint");
    assert.ok(row.styleLength > 0, "the row must ship its own styles");
    assert.match(row.switchClass, /_switch_[0-9a-z]+_[0-9a-z]+/u, "host Switch primitive");
    assert.equal(row.switchChecked, "true", "a freshly installed package starts enabled");

    // The row writes through the host's real settings service, and a second page
    // reads the stored value back.
    assert.equal(await toggle(page), copy.saved, "the switch saves through the settings service");
    const fresh = await browser.newContext();
    const freshRow = await openRow(await fresh.newPage(), plane.pageUrl);
    assert.equal(freshRow.switchChecked, "false", "the write persisted for a new page");
    assert.equal(freshRow.hint, copy.disabledHint, "the disabled hint reads back");
    await fresh.close();
    assert.equal(await toggle(page), copy.saved, "the switch re-enables");

    // The overlay half mounts in the host's own composer and paints a real
    // suggestion once a real turn completes.
    await openLiveSession(page, plane.pageUrl, plane.workspace);
    const before = await readOverlay(page);
    assert.equal(before.anchors, 1, "the overlay slot must mount once in the live composer");
    assert.equal(before.anchorLabel, copy.label, "the anchor carries the localized label");
    assert.equal(before.anchorHidden, true, "the anchor itself stays inert");
    assert.equal(before.cardFound, true, "the overlay must find the host composer card");
    assert.equal(before.editorEditable, "true", "the host composer must be editable");
    assert.equal(before.placeholderVisibility, "visible", "nothing is painted without a reply");
    assert.equal(before.ghostText, "", "no ghost before a suggestion is available");

    await page.locator('div[contenteditable="true"]').first().click({ timeout: 10_000 });
    await page.keyboard.type("Fix the login redirect");
    await page.keyboard.press("Enter");
    await until(
      async () => (await readOverlay(page)).ghostText,
      SUGGESTION,
      "the installed package never painted the suggestion after a completed turn",
    );
    assert.equal(
      (await readOverlay(page)).placeholderVisibility,
      "hidden",
      "ghost replaces the placeholder",
    );
    await page.keyboard.press("Tab");
    await until(
      async () => (await readOverlay(page)).draft,
      SUGGESTION,
      "Tab did not insert the suggestion into the draft",
      10_000,
    );
    await page.close();
  } finally {
    const failures: unknown[] = [];
    for (const step of [
      async () => browser?.close(),
      async () => plane?.close(),
      async () => server.close(),
    ]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) console.error("smoke-release: teardown failed", failures);
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
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch files, installed package rendered in the real host plane, toggled through the settings service and persisted across pages, overlay painted a real suggestion from a completed turn and Tab inserted it)`,
  );
}

main().catch((error: unknown) => {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
