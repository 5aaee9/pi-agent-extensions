/**
 * Drives this package's client half through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, and a real Chromium opens the
 * Settings sheet the host built. The settings navigation, the section slot, the
 * settings service the page reads and writes, the model catalog it offers, and the
 * locale service are the host's own, so these assertions cover what the release
 * actually ships rather than a stand-in rendering (`docs/conventions.md`, "real-plane
 * contract").
 *
 * Recorded boundary, not stubbed: the composer status entry (`dsha-status`) renders
 * nothing in this plane. It renders only from a ready config snapshot plus a route's
 * threshold, and in the live 0.2.2 session it stays empty even with the master switch
 * off, a saved deployment threshold and a selected model, so the reading is not
 * asserted here; see the package report.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";

import { DICT } from "../src/client/dictionary.ts";
import { launchBrowser, openSettingsSheet, openWebPlane, type WebPlane } from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SECTION = "section.dsha-page";
const copy = DICT["en"] as Record<string, string>;

let plane: WebPlane;
let browser: Browser;

beforeAll(async () => {
  plane = await openWebPlane([packageDir]);
  browser = await launchBrowser();
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  await plane?.close().catch(() => {});
});

/**
 * Open the Settings sheet and then this package's section through the host's own
 * settings navigation, which is the entry the section slot registers into.
 */
async function openAutocompactSettings(page: Page, url: string): Promise<void> {
  await openSettingsSheet(page, url, "body");
  await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button,[role=tab]")].find(
        (element) => (element.textContent ?? "").trim() === ${JSON.stringify(copy["nav"])},
      );
      button?.click();
    })()`);
  await page.locator(SECTION).waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForTimeout(1200);
}

interface PageSnapshot {
  readonly pages: number;
  readonly title: string;
  readonly intro: string;
  readonly switchChecked: string;
  readonly switchDisabled: boolean;
  readonly switchClass: string;
  readonly defaultLimit: string;
  readonly saveDisabled: boolean;
  readonly discardDisabled: boolean;
  readonly styleLength: number;
  readonly notice: string;
}

/** Read the rendered section straight out of the live page. */
async function readPage(page: Page): Promise<PageSnapshot> {
  const raw: unknown = await page.evaluate(`(() => {
    const root = document.querySelector("section.dsha-page");
    const toggle = root?.querySelector("[role=switch]");
    const inputs = [...(root?.querySelectorAll("input") ?? [])];
    const byLabel = (label) =>
      inputs.find((element) => element.getAttribute("aria-label") === label)?.value ?? null;
    const button = (text) =>
      [...(root?.querySelectorAll("button") ?? [])].find(
        (element) => (element.textContent ?? "").trim() === text,
      );
    return JSON.stringify({
      pages: document.querySelectorAll("section.dsha-page").length,
      title: root?.querySelector(".dsha-title")?.textContent?.trim() ?? "",
      intro: root?.querySelector(".dsha-intro")?.textContent?.trim() ?? "",
      switchChecked: toggle?.getAttribute("aria-checked") ?? "",
      switchDisabled: toggle?.disabled ?? null,
      switchClass: String(toggle?.className ?? ""),
      defaultLimit: byLabel("Default threshold"),
      saveDisabled: button("Save")?.disabled ?? null,
      discardDisabled: button("Discard")?.disabled ?? null,
      styleLength: (root?.querySelector("style")?.textContent ?? "").length,
      notice: root?.querySelector("[role=status]")?.textContent?.trim() ?? "",
    });
  })()`);
  return JSON.parse(String(raw)) as PageSnapshot;
}

/** Poll for the row's settled feedback instead of its transient "Saving…" copy. */
async function settledNotice(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () => await page.locator(`${SECTION} [role=status]`).first().textContent(), {
      timeout: 20_000,
    })
    .toBe(expected);
}

describe("settings section in the live Settings sheet", () => {
  it("mounts through the host's settings navigation with the package's own controls", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAutocompactSettings(page, plane.pageUrl);
      const view = await readPage(page);
      expect(view.pages).toBe(1);
      expect(view.title).toBe(copy["title"]);
      expect(view.intro).toBe(copy["intro"]);
      expect(view.switchClass).toBe("dsha-switch");
      expect(view.switchChecked).toBe("true");
      expect(view.switchDisabled).toBe(false);
      // A fresh profile has nothing staged: both actions stay inert until an
      // edit, and the input mirrors the host's stored value.
      expect(view.defaultLimit).toBe("");
      expect(view.saveDisabled).toBe(true);
      expect(view.discardDisabled).toBe(true);
      // The section ships its own stylesheet and the host injects it.
      expect(view.styleLength).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  }, 180_000);

  it("toggles the master switch through the host's settings service and persists it", async () => {
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    try {
      await openAutocompactSettings(firstPage, plane.pageUrl);
      await firstPage.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
      await expect
        .poll(
          async () =>
            await firstPage
              .locator(`${SECTION} [role=switch]`)
              .first()
              .getAttribute("aria-checked"),
          { timeout: 20_000 },
        )
        .toBe("false");
    } finally {
      await first.close();
    }

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    try {
      await openAutocompactSettings(secondPage, plane.pageUrl);
      expect((await readPage(secondPage)).switchChecked).toBe("false");
    } finally {
      await second.close();
    }

    const third = await browser.newContext();
    const thirdPage = await third.newPage();
    try {
      await openAutocompactSettings(thirdPage, plane.pageUrl);
      await thirdPage.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
      await expect
        .poll(
          async () =>
            await thirdPage
              .locator(`${SECTION} [role=switch]`)
              .first()
              .getAttribute("aria-checked"),
          { timeout: 20_000 },
        )
        .toBe("true");
    } finally {
      await third.close();
    }
  }, 300_000);

  it("saves a deployment threshold through the real settings service and reads it back", async () => {
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    try {
      await openAutocompactSettings(firstPage, plane.pageUrl);
      await firstPage
        .locator(`${SECTION} input[aria-label="Default threshold"]`)
        .first()
        .fill("300k");
      // Staged edits unlock the actions.
      const staged = await readPage(firstPage);
      expect(staged.saveDisabled).toBe(false);
      expect(staged.discardDisabled).toBe(false);
      await firstPage
        .locator(`${SECTION} button`, { hasText: "Save" })
        .first()
        .click({ timeout: 10_000 });
      await settledNotice(firstPage, copy["saved"]);
      // The stored form comes back from the host, not from the draft.
      expect((await readPage(firstPage)).defaultLimit).toBe("300000");
    } finally {
      await first.close();
    }

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    try {
      await openAutocompactSettings(secondPage, plane.pageUrl);
      expect((await readPage(secondPage)).defaultLimit).toBe("300000");
      // Blank clears the deployment default again, through the same service.
      await secondPage.locator(`${SECTION} input[aria-label="Default threshold"]`).first().fill("");
      await secondPage
        .locator(`${SECTION} button`, { hasText: "Save" })
        .first()
        .click({ timeout: 10_000 });
      await settledNotice(secondPage, copy["saved"]);
      expect((await readPage(secondPage)).defaultLimit).toBe("");
    } finally {
      await second.close();
    }
  }, 300_000);

  it("refuses a threshold the host's own parser rejects instead of writing it", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAutocompactSettings(page, plane.pageUrl);
      const input = page.locator(`${SECTION} input[aria-label="Default threshold"]`).first();
      await input.fill("not-a-count");
      await expect
        .poll(async () => await input.getAttribute("aria-invalid"), { timeout: 10_000 })
        .toBe("true");
      await page.locator(`${SECTION} button`, { hasText: "Save" }).first().click({
        timeout: 10_000,
      });
      await settledNotice(page, copy["invalid"]);
      // Nothing was written: a new page still sees no deployment default.
      const fresh = await browser.newContext();
      const freshPage = await fresh.newPage();
      await openAutocompactSettings(freshPage, plane.pageUrl);
      expect((await readPage(freshPage)).defaultLimit).toBe("");
      await fresh.close();
    } finally {
      await context.close();
    }
  }, 240_000);
});
