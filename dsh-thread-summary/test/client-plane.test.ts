/**
 * Drives this package's client half through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, and a real Chromium loads the page
 * the host built. The slot registry, locale service, settings service, session model
 * catalog, and UI primitives are the host's own, so these assertions cover what the
 * release actually ships rather than a stand-in rendering (`docs/conventions.md`,
 * "real-plane contract").
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  launchBrowser,
  openSettingsSheet,
  openWebPlane,
  reopenSettingsSheet,
  type WebPlane,
} from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

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

async function readRow(page: import("playwright").Page): Promise<RowSnapshot> {
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

async function checkedState(page: import("playwright").Page): Promise<string | null> {
  return await page
    .locator(".dsh-thread-summary [role=switch]")
    .first()
    .getAttribute("aria-checked");
}

async function statusText(
  page: import("playwright").Page,
): Promise<{ text: string; tone: string | null }> {
  const status = page.locator(".dsh-thread-summary .dsh-summary-status[data-tone]").first();
  await status.waitFor({ state: "attached", timeout: 8_000 });
  return {
    text: (await status.textContent())?.trim() ?? "",
    tone: await status.getAttribute("data-tone"),
  };
}

async function clickSwitch(page: import("playwright").Page): Promise<void> {
  await page.locator(".dsh-thread-summary [role=switch]").first().click({ timeout: 8_000 });
}

async function clickSave(page: import("playwright").Page): Promise<void> {
  await page
    .locator(".dsh-thread-summary button.dsh-summary-save")
    .first()
    .click({ timeout: 8_000 });
}

/** Open the Settings sheet again in an already loaded page. */
async function reopenSettings(page: import("playwright").Page): Promise<void> {
  await reopenSettingsSheet(page, "section.dsh-thread-summary");
}

describe("thread summary row in the running web app", () => {
  let plane: WebPlane;
  let browser: import("playwright").Browser;
  let page: import("playwright").Page;

  beforeAll(async () => {
    plane = await openWebPlane([packageDir]);
    browser = await launchBrowser();
    page = await browser.newPage();
    await openSettingsSheet(page, plane.pageUrl, "section.dsh-thread-summary");
  }, 180_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await plane?.close().catch(() => {});
  });

  it("mounts one additive row in the host's General settings tab", async () => {
    const row = await readRow(page);
    expect(row.root).toBe(1);
    expect(row.title).toBe("Summary model");
    expect(row.description).toBe("Name new sessions from your first message.");
    expect(row.styleRules).toBeGreaterThan(0);
  });

  it("renders with the host's own UI primitives", async () => {
    const row = await readRow(page);
    expect(row.switchChecked).toBe("true");
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
        token: token ?? "",
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

  it("writes through the host settings service and keeps the value across a reload", async () => {
    await clickSwitch(page);
    expect(await checkedState(page)).toBe("false");
    await clickSave(page);
    const status = await statusText(page);
    expect(status.text).toBe("Saved");
    expect(status.tone).toBe("success");

    await page.reload({ waitUntil: "load" });
    await reopenSettings(page);
    expect(await checkedState(page)).toBe("false");
  }, 90_000);

  it("keeps Save disabled while an enabled row has no model route", async () => {
    await clickSwitch(page);
    expect(await checkedState(page)).toBe("true");
    const save = page.locator(".dsh-thread-summary button.dsh-summary-save").first();
    await expect(save.isEnabled()).resolves.toBe(false);
  }, 45_000);
});

describe("thread summary row with the host model catalog", () => {
  let plane: WebPlane;
  let browser: import("playwright").Browser;
  let page: import("playwright").Page;

  beforeAll(async () => {
    plane = await openWebPlane([packageDir, "@jiesou/dsh-opencode-zen-free-provider"]);
    browser = await launchBrowser();
    page = await browser.newPage();
    await openSettingsSheet(page, plane.pageUrl, "section.dsh-thread-summary");
  }, 240_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await plane?.close().catch(() => {});
  });

  it("fills the pickers from the live model catalog", async () => {
    const triggers = page.locator(".dsh-thread-summary button.dsh-summary-trigger");
    expect(await triggers.count()).toBe(2);
    const provider: string = (await triggers.nth(0).textContent())?.trim() ?? "";
    const model: string = (await triggers.nth(1).textContent())?.trim() ?? "";
    expect(provider).toBe("OpenCode Zen Free");
    expect(model).not.toBe("");

    await triggers.nth(0).click({ timeout: 8_000 });
    await page.locator(".dsh-summary-menu").first().waitFor({ state: "attached", timeout: 5_000 });
    const raw: unknown = await page.evaluate(`(() => {
      const menu = document.querySelector(".dsh-summary-menu");
      return JSON.stringify([...(menu?.querySelectorAll("button,[role=menuitem],[role=option]") ?? [])].map(
        (element) => (element.textContent ?? "").trim(),
      ));
    })()`);
    const entries = JSON.parse(String(raw)) as string[];
    expect(entries.some((entry) => entry.includes("OpenCode Zen Free"))).toBe(true);
    await page.keyboard.press("Escape");
  }, 45_000);

  it("saves the auto-selected route and reads it back in a fresh page", async () => {
    const save = page.locator(".dsh-thread-summary button.dsh-summary-save").first();
    await expect(save.isEnabled()).resolves.toBe(true);
    await clickSave(page);
    const status = await statusText(page);
    expect(status.text).toBe("Saved");

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await openSettingsSheet(fresh, plane.pageUrl, "section.dsh-thread-summary");
    expect(
      (
        await fresh.locator(".dsh-thread-summary button.dsh-summary-trigger").first().textContent()
      )?.trim(),
    ).toBe("OpenCode Zen Free");
    await expect(
      fresh.locator(".dsh-thread-summary [role=switch]").first().getAttribute("aria-checked"),
    ).resolves.toBe("true");
    await context.close();
  }, 120_000);

  it("reports a real settings conflict from a second live page", async () => {
    const context = await browser.newContext();
    const other = await context.newPage();
    await openSettingsSheet(other, plane.pageUrl, "section.dsh-thread-summary");
    await clickSwitch(other);
    await clickSave(other);
    await statusText(other);

    await clickSwitch(page);
    const staleSave = page.locator(".dsh-thread-summary button.dsh-summary-save").first();
    await expect(staleSave.isEnabled()).resolves.toBe(true);
    await staleSave.click({ timeout: 8_000 });
    const status = await statusText(page);
    expect(status.text).toContain("Settings changed elsewhere");
    await context.close();
  }, 180_000);
});
