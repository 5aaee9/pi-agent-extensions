/**
 * Drives this package's client half through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, and a real Chromium loads the page
 * the host built. The slot registry, locale service, settings service, session model
 * catalog, and UI primitives are the host's own, so these assertions cover what the
 * release actually ships rather than a stand-in rendering (`docs/conventions.md`,
 * "Tests"). The model catalog is the base bundle's own `llm-pi-ai` adapter, given a
 * `providers` section that routes to a locally started endpoint.
 *
 * Order independence: every test opens its own page in a fresh browser context and
 * asserts relative to the state it reads first, so any test can run alone (`-t`).
 *
 * Not recoverable on the pinned 0.2.2 host, so not asserted (each needs a host state
 * the real plane cannot enter):
 * - a read-only profile: the pinned settings service hardcodes `writable: true`;
 * - a rejected or failed settings load, and settings being unavailable: the client
 *   manifest injects `remote.settings`, so the host does not mount the row without it,
 *   and its `describe()` has no failing path a profile can trigger;
 * - a rejected model catalog: the host answers `modelCatalog()` from its registered
 *   adapters, and an invalid provider profile is kept as a diagnostic, not an error;
 * - a failed reload after a revision conflict: it needs `describe()` to fail between
 *   two calls;
 * - the render error boundary: no host state makes the row throw while rendering.
 */

import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MODEL_API_KEY, MODEL_API_KEY_ENV, startModelServer } from "./model-server.ts";
import type { ModelServer } from "./model-server.ts";
import {
  assertFreshBuild,
  launchBrowser,
  openSettingsSheet,
  openWebPlane,
  reopenSettingsSheet,
  type WebPlane,
} from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROW = "section.dsh-thread-summary";
const HOOK_TIMEOUT = 30_000;
/** Each test opens its own page; a loaded CI machine needs more than Vitest's 5 s default. */
const TEST_TIMEOUT = 60_000;

interface RowSnapshot {
  readonly root: number;
  readonly title: string;
  readonly description: string;
  readonly switchClass: string;
  readonly switchChecked: string;
  readonly triggers: string[];
  readonly saveClass: string;
  readonly styleRules: number;
}

async function readRow(page: Page): Promise<RowSnapshot> {
  const raw: unknown = await page.evaluate(`(() => {
    const root = document.querySelector("section.dsh-thread-summary");
    const switchElement = document.querySelector(".dsh-thread-summary [role=switch]");
    const save = document.querySelector(".dsh-thread-summary button.dsh-summary-save");
    return JSON.stringify({
      root: document.querySelectorAll("section.dsh-thread-summary").length,
      title: document.querySelector(".dsh-thread-summary h3.dsh-summary-title")?.textContent ?? "",
      description: document.querySelector(".dsh-thread-summary p.dsh-summary-description")?.textContent ?? "",
      switchClass: switchElement?.className ?? "",
      switchChecked: switchElement?.getAttribute("aria-checked") ?? "",
      triggers: [...document.querySelectorAll(".dsh-thread-summary button.dsh-summary-trigger")].map(
        (element) => element.className,
      ),
      saveClass: save?.className ?? "",
      styleRules: root?.querySelector("style") === null ? 0 : (root.querySelector("style")?.textContent ?? "").length,
    });
  })()`);
  return JSON.parse(String(raw)) as RowSnapshot;
}

/** The host's primitives ship CSS-module class names such as `_switch_1ik0f_5`. */
function hasPrimitiveToken(className: string, component: string): boolean {
  const pattern = new RegExp(`^_${component}_[0-9a-z]+_[0-9a-z]+$`);
  return className
    .trim()
    .split(/\s+/)
    .some((token) => pattern.test(token));
}

const switchOf = (page: Page) => page.locator(`${ROW} [role=switch]`).first();
const saveOf = (page: Page) => page.locator(`${ROW} button.dsh-summary-save`).first();
const triggersOf = (page: Page) => page.locator(`${ROW} button.dsh-summary-trigger`);

async function checkedState(page: Page): Promise<string | null> {
  return await switchOf(page).getAttribute("aria-checked");
}

/** Wait until the row settles on a status line, then read it. */
async function settledStatus(page: Page): Promise<{ text: string; tone: string | null }> {
  await page.locator(`${ROW}[aria-busy=false]`).waitFor({ state: "visible", timeout: 15_000 });
  const status = page.locator(`${ROW} .dsh-summary-status[data-tone]`).first();
  await status.waitFor({ state: "visible", timeout: 15_000 });
  return {
    text: (await status.textContent())?.trim() ?? "",
    tone: await status.getAttribute("data-tone"),
  };
}

/** Flip the switch and wait for the rendered state to follow. */
async function toggle(page: Page): Promise<string> {
  const before = await checkedState(page);
  const after = before === "true" ? "false" : "true";
  await switchOf(page).click({ timeout: 8_000 });
  await page
    .locator(`${ROW} [role=switch][aria-checked=${after}]`)
    .waitFor({ state: "visible", timeout: 5_000 });
  return after;
}

/** Open the provider picker and read its entries. */
async function providerEntries(page: Page): Promise<string[]> {
  await triggersOf(page).nth(0).click({ timeout: 8_000 });
  const menu = page.locator(".dsh-summary-menu").first();
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  const entries = (
    await menu.locator("[role=menuitem],[role=option],button").allTextContents()
  ).map((entry) => entry.trim());
  return entries;
}

/** A browser context per test keeps every test independent of the page before it. */
function freshPages(get: () => { browser: Browser; plane: WebPlane }) {
  const contexts: BrowserContext[] = [];
  const open = async (): Promise<Page> => {
    const { browser, plane } = get();
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await openSettingsSheet(page, plane.pageUrl, ROW);
    return page;
  };
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
  }, HOOK_TIMEOUT);
  return open;
}

async function closeAll(
  browser: Browser | undefined,
  plane: WebPlane | undefined,
  server?: ModelServer,
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of [() => browser?.close(), () => plane?.close(), () => server?.close()]) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "the web plane did not tear down cleanly");
  }
}

/** A catalog of two local routes, the second one with two models. */
function catalog(baseURL: string): Record<string, unknown> {
  const route = (displayName: string, models: [string, string][]) => ({
    displayName,
    api: "openai-completions",
    baseURL,
    apiKeyEnv: MODEL_API_KEY_ENV,
    models: models.map(([id, name]) => ({ id, name, reasoningEfforts: false })),
  });
  return {
    local: route("Local Summary Endpoint", [["summary-model", "Local Summary Model"]]),
    second: route("Second Endpoint", [
      ["second-a", "Second Model A"],
      ["second-b", "Second Model B"],
    ]),
  };
}

beforeAll(() => {
  assertFreshBuild(packageDir);
});

describe("thread summary row in the running web app", { timeout: TEST_TIMEOUT }, () => {
  let plane: WebPlane | undefined;
  let browser: Browser | undefined;
  const open = freshPages(() => ({ browser: browser!, plane: plane! }));

  beforeAll(async () => {
    plane = await openWebPlane([packageDir]);
    browser = await launchBrowser();
  }, 240_000);

  afterAll(() => closeAll(browser, plane), HOOK_TIMEOUT);

  it("mounts one additive row in the host's General settings tab", async () => {
    const page = await open();
    const row = await readRow(page);
    expect(row.root).toBe(1);
    expect(row.title).toBe("Summary model");
    expect(row.description).toBe("Name new sessions from your first message.");
    expect(row.styleRules).toBeGreaterThan(0);
  });

  it("renders with the host's own UI primitives", async () => {
    const page = await open();
    const row = await readRow(page);
    expect(hasPrimitiveToken(row.switchClass, "switch")).toBe(true);
    expect(row.triggers).toHaveLength(2);
    for (const trigger of row.triggers) {
      expect(hasPrimitiveToken(trigger, "button")).toBe(true);
    }
    expect(hasPrimitiveToken(row.saveClass, "button")).toBe(true);
    // The host's own CSS module must actually style the element: the class token
    // appears in an injected sheet, and the computed values come from it.
    const proof: unknown = await page.evaluate((className: string) => {
      const token = className
        .split(/\s+/)
        .find((name) => /^_primary_[0-9a-z]+_[0-9a-z]+$/.test(name));
      let rules = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        let entries: CSSRuleList | undefined;
        try {
          entries = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(entries ?? [])) {
          const selector = "selectorText" in rule ? rule.selectorText : undefined;
          if (token !== undefined && typeof selector === "string" && selector.includes(token))
            rules += 1;
        }
      }
      const save = document.querySelector(".dsh-thread-summary button.dsh-summary-save");
      const style = save === null ? null : getComputedStyle(save);
      return JSON.stringify({
        rules,
        radius: style?.borderRadius ?? "",
        background: style?.backgroundColor ?? "",
      });
    }, row.saveClass);
    const applied = JSON.parse(String(proof)) as {
      rules: number;
      radius: string;
      background: string;
    };
    expect(applied.rules).toBeGreaterThan(0);
    expect(applied.radius).toMatch(/^\d+(\.\d+)?px$/);
    expect(applied.background).toMatch(/^rgb/);
  });

  it("shows the empty catalog in both pickers", async () => {
    const page = await open();
    const triggers = triggersOf(page);
    expect((await triggers.nth(0).textContent())?.trim()).toBe("No providers available");
    await expect(triggers.nth(0).isEnabled()).resolves.toBe(false);
    await expect(triggers.nth(1).isEnabled()).resolves.toBe(false);
  });

  it("writes the switch through the host settings service and keeps it across a reload", async () => {
    const page = await open();
    // Without a catalog only "off" can be saved, so bring the row there first if needed.
    if ((await checkedState(page)) === "true") await toggle(page);
    else {
      await toggle(page);
      await toggle(page);
    }
    expect(await checkedState(page)).toBe("false");
    await saveOf(page).click({ timeout: 8_000 });
    await expect(settledStatus(page)).resolves.toEqual({ text: "Saved", tone: "success" });
    expect(await page.locator(`${ROW} .dsh-summary-hint`).count()).toBe(0);

    await page.reload({ waitUntil: "load" });
    await reopenSettingsSheet(page, ROW);
    expect(await checkedState(page)).toBe("false");
    await expect(page.locator(`${ROW} .dsh-summary-hint`).textContent()).resolves.toBe(
      "Automatic titles are off. Sessions use a default title.",
    );
  }, 90_000);

  it("keeps Save disabled while an enabled row has no model route", async () => {
    const page = await open();
    if ((await checkedState(page)) === "false") await toggle(page);
    expect(await checkedState(page)).toBe("true");
    await expect(saveOf(page).isEnabled()).resolves.toBe(false);
  }, 45_000);
});

describe("thread summary row with the host model catalog", { timeout: TEST_TIMEOUT }, () => {
  let server: ModelServer | undefined;
  let plane: WebPlane | undefined;
  let browser: Browser | undefined;
  const open = freshPages(() => ({ browser: browser!, plane: plane! }));

  beforeAll(async () => {
    server = await startModelServer();
    plane = await openWebPlane([packageDir], {
      patch: [{ id: "llm-pi-ai", config: { providers: catalog(server.baseURL) } }],
      env: { [MODEL_API_KEY_ENV]: MODEL_API_KEY },
    });
    browser = await launchBrowser();
  }, 240_000);

  afterAll(() => closeAll(browser, plane, server), HOOK_TIMEOUT);

  it("fills the pickers from the live model catalog", async () => {
    const page = await open();
    const triggers = triggersOf(page);
    expect(await triggers.count()).toBe(2);
    const provider = (await triggers.nth(0).textContent())?.trim() ?? "";
    expect(["Local Summary Endpoint", "Second Endpoint"]).toContain(provider);
    expect((await triggers.nth(1).textContent())?.trim()).not.toBe("");
    const entries = await providerEntries(page);
    expect(entries).toEqual(expect.arrayContaining(["Local Summary Endpoint", "Second Endpoint"]));
    await page.keyboard.press("Escape");
  }, 45_000);

  it("switches provider models and reads the saved route back in a fresh page", async () => {
    const page = await open();
    const current = (await triggersOf(page).nth(0).textContent())?.trim();
    const target = current === "Second Endpoint" ? "Local Summary Endpoint" : "Second Endpoint";
    const firstModel = target === "Second Endpoint" ? "Second Model A" : "Local Summary Model";
    await providerEntries(page);
    await page.locator(".dsh-summary-menu").first().getByText(target, { exact: true }).click();
    // Changing provider selects that provider's first model.
    await expect(triggersOf(page).nth(0).textContent()).resolves.toContain(target);
    await expect(triggersOf(page).nth(1).textContent()).resolves.toContain(firstModel);
    if ((await checkedState(page)) === "false") await toggle(page);
    await saveOf(page).click({ timeout: 8_000 });
    await expect(settledStatus(page)).resolves.toEqual({ text: "Saved", tone: "success" });

    const fresh = await open();
    expect((await triggersOf(fresh).nth(0).textContent())?.trim()).toBe(target);
    expect((await triggersOf(fresh).nth(1).textContent())?.trim()).toBe(firstModel);
    expect(await checkedState(fresh)).toBe("true");
  }, 120_000);

  it("writes once when Save is pressed twice while the first write is pending", async () => {
    const page = await open();
    await toggle(page);
    // A second write would carry the now-stale revision and be refused as a conflict.
    await saveOf(page).dblclick({ timeout: 8_000 });
    await expect(settledStatus(page)).resolves.toEqual({ text: "Saved", tone: "success" });
  }, 60_000);

  it("reports a real settings conflict, reloads the other page's value and saves again", async () => {
    const page = await open();
    const other = await open();
    const otherValue = await toggle(other);
    await saveOf(other).click({ timeout: 8_000 });
    await expect(settledStatus(other)).resolves.toEqual({ text: "Saved", tone: "success" });

    // `page` still holds the revision it loaded with.
    await toggle(page);
    await saveOf(page).click({ timeout: 8_000 });
    const conflict = await settledStatus(page);
    expect(conflict.text).toBe(
      "Settings changed elsewhere. Review the reloaded values and save again.",
    );
    expect(conflict.tone).toBe("error");
    // The row reloaded the value the other page wrote, and writes again on the new revision.
    expect(await checkedState(page)).toBe(otherValue);
    await toggle(page);
    await saveOf(page).click({ timeout: 8_000 });
    await expect(settledStatus(page)).resolves.toEqual({ text: "Saved", tone: "success" });
  }, 120_000);
});

describe(
  "thread summary row with a saved route the catalog no longer serves",
  { timeout: TEST_TIMEOUT },
  () => {
    let server: ModelServer | undefined;
    let plane: WebPlane | undefined;
    let browser: Browser | undefined;
    const open = freshPages(() => ({ browser: browser!, plane: plane! }));

    beforeAll(async () => {
      server = await startModelServer();
      plane = await openWebPlane([packageDir], {
        patch: [
          { id: "llm-pi-ai", config: { providers: catalog(server.baseURL) } },
          {
            id: "thread-summary",
            name: "@indexyz/dsh-thread-summary",
            config: { enabled: true, model: "retired/old-model" },
          },
        ],
        env: { [MODEL_API_KEY_ENV]: MODEL_API_KEY },
      });
      browser = await launchBrowser();
    }, 240_000);

    afterAll(() => closeAll(browser, plane, server), HOOK_TIMEOUT);

    it("keeps the saved route instead of replacing it with a catalog default", async () => {
      const page = await open();
      expect((await triggersOf(page).nth(0).textContent())?.trim()).toBe("retired");
      expect((await triggersOf(page).nth(1).textContent())?.trim()).toBe("old-model");
      const entries = await providerEntries(page);
      expect(entries).toEqual(
        expect.arrayContaining(["retired", "Local Summary Endpoint", "Second Endpoint"]),
      );
      await page.keyboard.press("Escape");
      await expect(saveOf(page).isEnabled()).resolves.toBe(true);
    }, 45_000);

    it("contains a write the host refuses and restores the Save button", async () => {
      const page = await open();
      const profileDir = dirname(plane!.patchPath);
      // The host writes the profile patch atomically inside this directory; a
      // directory it cannot write to makes the real settings service refuse.
      chmodSync(profileDir, 0o555);
      try {
        await toggle(page);
        await saveOf(page).click({ timeout: 8_000 });
        const status = await settledStatus(page);
        expect(status.tone).toBe("error");
        expect(status.text).not.toBe("Saved");
        expect(status.text.length).toBeGreaterThan(0);
        await expect(saveOf(page).isEnabled()).resolves.toBe(true);
        await expect(saveOf(page).textContent()).resolves.toBe("Save");
      } finally {
        chmodSync(profileDir, 0o755);
      }
    }, 60_000);
  },
);
