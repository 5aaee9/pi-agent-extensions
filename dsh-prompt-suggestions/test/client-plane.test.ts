/**
 * Drives this package's client halves through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, a real workspace directory is
 * opened through the host's own picker, and a real Chromium loads the page the host
 * built. The slot registry, locale service, settings service, session store, composer
 * DOM, and UI primitives are the host's own, so these assertions cover what the
 * release actually ships rather than a stand-in rendering (`docs/conventions.md`,
 * "real-plane contract").
 *
 * The composer ghost is painted only after a completed model reply. This environment
 * cannot produce one (every free OpenCode Zen model answers 429 "Request quota
 * exhausted" and the host has no credentialed route), so this file covers everything
 * up to that point and the ghost painting itself stays with the DOM helpers in
 * `client-utils.test.ts`. It is not faked here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";

import { DICT } from "../src/client/dictionary.ts";
import {
  launchBrowser,
  openLiveSession,
  openSettingsSheet,
  openWebPlane,
  type WebPlane,
} from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROW = "section.dsh-prompt-suggestions";
const copy = DICT.en;

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

/** Read the rendered settings row straight out of the live page. */
async function readRow(page: Page): Promise<{
  rows: number;
  title: string;
  description: string;
  hint: string;
  switchChecked: string;
  switchClass: string;
  switchLabel: string;
  styleLength: number;
}> {
  const raw: unknown = await page.evaluate(`(() => {
    const row = document.querySelector("${ROW}");
    const toggle = row?.querySelector("[role=switch]");
    const text = (selector) => row?.querySelector(selector)?.textContent?.trim() ?? "";
    return JSON.stringify({
      rows: document.querySelectorAll("${ROW}").length,
      title: text("h3.dsh-prompt-suggestions-title"),
      description: text(".dsh-prompt-suggestions-description"),
      hint: text(".dsh-prompt-suggestions-hint"),
      switchChecked: toggle?.getAttribute("aria-checked") ?? "",
      switchClass: String(toggle?.className ?? ""),
      switchLabel: toggle?.getAttribute("aria-label") ?? "",
      styleLength: row?.querySelector("style")?.textContent?.length ?? 0,
    });
  })()`);
  return JSON.parse(String(raw)) as Awaited<ReturnType<typeof readRow>>;
}

/** The composer geometry the overlay's ghost placement relies on. */
interface ComposerContract {
  readonly anchors: number;
  readonly anchorLabel: string;
  readonly anchorHidden: boolean;
  readonly anchorAriaHidden: string;
  readonly cardFound: boolean;
  readonly editorEditable: string;
  readonly placeholderText: string;
  readonly placeholderVisibility: string;
  readonly ghosts: number;
  readonly draft: string;
}

async function readComposer(page: Page): Promise<ComposerContract> {
  const raw: unknown = await page.evaluate(`(() => {
    const anchor = document.querySelector("[data-prompt-suggestions-anchor]");
    const card = anchor?.closest("[data-composer-card]") ?? null;
    const editor = card?.querySelector('[contenteditable="true"]') ?? null;
    const placeholder = card?.querySelector("[data-composer-placeholder]") ?? null;
    return JSON.stringify({
      anchors: document.querySelectorAll("[data-prompt-suggestions-anchor]").length,
      anchorLabel: anchor?.getAttribute("data-prompt-suggestions-anchor") ?? "",
      anchorHidden: anchor?.hasAttribute("hidden") ?? false,
      anchorAriaHidden: anchor?.getAttribute("aria-hidden") ?? "",
      cardFound: card !== null,
      editorEditable: editor?.getAttribute("contenteditable") ?? "",
      placeholderText: placeholder?.textContent?.trim() ?? "",
      placeholderVisibility:
        placeholder === null ? "" : getComputedStyle(placeholder).visibility,
      ghosts: document.querySelectorAll("[data-prompt-suggestions]").length,
      draft: editor?.textContent ?? "",
    });
  })()`);
  return JSON.parse(String(raw)) as ComposerContract;
}

describe("settings.general.item in the live General tab", () => {
  it("renders this package's row through the host's slot and Switch primitive", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openSettingsSheet(page, plane.pageUrl, ROW);
      const row = await readRow(page);
      expect(row.rows).toBe(1);
      expect(row.title).toBe(copy.label);
      expect(row.description).toBe(copy.description);
      expect(row.hint).toBe(copy.hint);
      expect(row.switchChecked).toBe("true");
      expect(row.switchLabel).toBe(copy.switch);
      // The host renders its own Switch and really styles it: the primitive's CSS
      // module class and this package's injected sheet both reach the live DOM.
      expect(row.switchClass).toMatch(/_switch_[0-9a-z]+_[0-9a-z]+/);
      expect(row.styleLength).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("writes through the settings service immediately and persists for a new page", async () => {
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    try {
      await openSettingsSheet(firstPage, plane.pageUrl, ROW);
      await firstPage.locator(`${ROW} [role=switch]`).first().click({ timeout: 10_000 });
      const status = firstPage.locator(`${ROW} [role=status][data-tone]`).first();
      await status.waitFor({ state: "attached", timeout: 15_000 });
      // The row renders "Saving…" first, so wait for the settled copy.
      await expect
        .poll(async () => (await status.textContent())?.trim(), { timeout: 20_000 })
        .toBe(copy.saved);
      expect(await status.getAttribute("data-tone")).toBe("success");
    } finally {
      await first.close();
    }

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    try {
      await openSettingsSheet(secondPage, plane.pageUrl, ROW);
      const row = await readRow(secondPage);
      expect(row.switchChecked).toBe("false");
      expect(row.hint).toBe(copy.disabledHint);
      // Leave the profile enabled again so the overlay half starts from the
      // published default.
      await secondPage.locator(`${ROW} [role=switch]`).first().click({ timeout: 10_000 });
      const status = secondPage.locator(`${ROW} [role=status][data-tone]`).first();
      await status.waitFor({ state: "attached", timeout: 15_000 });
      await expect
        .poll(async () => (await status.textContent())?.trim(), { timeout: 20_000 })
        .toBe(copy.saved);
      expect(await status.getAttribute("data-tone")).toBe("success");
      expect((await readRow(secondPage)).switchChecked).toBe("true");
    } finally {
      await second.close();
    }
  }, 180_000);
});

describe("conversation.input.overlay in a live session", () => {
  it("mounts inside the host composer and locates its geometry", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openLiveSession(page, plane.pageUrl, plane.workspace);
      const composer = await readComposer(page);
      expect(composer.anchors).toBe(1);
      expect(composer.anchorLabel).toBe(copy.label);
      expect(composer.anchorHidden).toBe(true);
      expect(composer.anchorAriaHidden).toBe("true");
      // The resident composer really exposes the three parts the ghost placement
      // consumes, and nothing is painted while no suggestion is pending.
      expect(composer.cardFound).toBe(true);
      expect(composer.editorEditable).toBe("true");
      expect(composer.placeholderText.length).toBeGreaterThan(0);
      expect(composer.placeholderVisibility).toBe("visible");
      expect(composer.ghosts).toBe(0);
      expect(composer.draft).toBe("");
    } finally {
      await context.close();
    }
  }, 180_000);

  it("leaves Tab and Escape alone while no suggestion is pending", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openLiveSession(page, plane.pageUrl, plane.workspace);
      await page.locator('div[contenteditable="true"]').first().click({ timeout: 10_000 });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      const composer = await readComposer(page);
      // The accept and dismiss gestures only act on a visible suggestion, so
      // neither one may fill the draft or paint a ghost on an empty turn.
      expect(composer.draft).toBe("");
      expect(composer.ghosts).toBe(0);
      expect(composer.placeholderVisibility).toBe("visible");
      expect(await page.locator('div[contenteditable="true"]').count()).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  }, 180_000);
});
