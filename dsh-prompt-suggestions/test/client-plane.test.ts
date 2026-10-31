/**
 * Drives this package's client halves through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, a real workspace directory is
 * opened through the host's own picker, and a real Chromium loads the page the host
 * built. The slot registry, locale service, settings service, session store, composer
 * DOM, and UI primitives are the host's own (`docs/conventions.md`, "Tests").
 *
 * The profile's own `llm-pi-ai` adapter is pointed at a locally started
 * OpenAI-compatible endpoint (`model-server.ts`) and its model selected as the
 * default, so a prompt typed into the live composer completes a real turn through
 * the host's agent loop and the host half generates the suggestion through the same
 * real stack. The endpoint only decides what the model says.
 *
 * Each test opens its own workspace (and therefore its own session) and sets the
 * switch state it needs, so no test depends on another's leftovers.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";

import { DICT } from "../src/client/dictionary.ts";
import { SUGGESTION_INSTRUCTIONS } from "../src/host/constants.ts";
import { startModelServer, type Exchange, type ModelServer } from "./model-server.ts";
import {
  assertFreshBuild,
  launchBrowser,
  LOCAL_KEY_REF,
  localModelPatch,
  openLiveSession,
  openSettingsSheet,
  openWebPlane,
  type WebPlane,
} from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROW = "section.dsh-prompt-suggestions";
const SWITCH = `${ROW} [role=switch]`;
const GHOST = "[data-prompt-suggestions]";
const EDITOR = 'div[contenteditable="true"]';
const SUGGESTION = "Add a regression test";
const copy = DICT.en;

/** How the local endpoint answers the three request kinds the host sends. */
interface ModelScript {
  /** Hold the main agent reply open until released. */
  holdMain: boolean;
  /** Hold the suggestion reply open until released. */
  holdSuggestion: boolean;
  readonly held: Exchange[];
  readonly suggestions: Exchange[];
  readonly mains: Exchange[];
}

const script: ModelScript = {
  holdMain: false,
  holdSuggestion: false,
  held: [],
  suggestions: [],
  mains: [],
};

function kindOf(exchange: Exchange): "suggestion" | "main" | "other" {
  const messages = exchange.request.body["messages"];
  const first = Array.isArray(messages) ? (messages[0] as { content?: unknown }) : undefined;
  if (first?.content === SUGGESTION_INSTRUCTIONS) return "suggestion";
  return Array.isArray(exchange.request.body["tools"]) ? "main" : "other";
}

function reply(exchange: Exchange, text: string): void {
  exchange.chunk({ role: "assistant", content: text });
  exchange.chunk({}, "stop");
  exchange.done();
}

let plane: WebPlane | undefined;
let browser: Browser | undefined;
let server: ModelServer | undefined;
let contexts: BrowserContext[] = [];
let workspaces = 0;

beforeAll(async () => {
  assertFreshBuild(packageDir);
  server = await startModelServer((exchange) => {
    const kind = kindOf(exchange);
    if (kind === "suggestion") {
      script.suggestions.push(exchange);
      if (script.holdSuggestion) script.held.push(exchange);
      else reply(exchange, SUGGESTION);
      return;
    }
    if (kind === "main") {
      script.mains.push(exchange);
      if (script.holdMain) {
        script.held.push(exchange);
        exchange.chunk({ role: "assistant" });
      } else reply(exchange, "Done.");
      return;
    }
    reply(exchange, "Session title");
  });
  plane = await openWebPlane([packageDir], {
    patch: localModelPatch(server.baseURL),
    env: { [LOCAL_KEY_REF]: "local-endpoint-key" },
  });
  browser = await launchBrowser();
}, 300_000);

afterAll(async () => {
  const failures: unknown[] = [];
  for (const step of [
    async () => {
      for (const context of contexts) await context.close();
    },
    async () => browser?.close(),
    async () => plane?.close(),
    async () => server?.close(),
  ]) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "web-plane teardown failed");
  }
}, 60_000);

function live(): { plane: WebPlane; browser: Browser } {
  if (plane === undefined || browser === undefined) throw new Error("the web plane did not start");
  return { plane, browser };
}

async function newPage(): Promise<Page> {
  const context = await live().browser.newContext();
  contexts.push(context);
  return await context.newPage();
}

async function closePages(): Promise<void> {
  const open = contexts;
  contexts = [];
  for (const context of open) await context.close();
}

/** Read the rendered settings row straight out of the live page. */
async function readRow(page: Page): Promise<{
  rows: number;
  title: string;
  description: string;
  hint: string;
  status: string;
  tone: string;
  switchChecked: string;
  switchDisabled: boolean;
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
      status: text("[role=status]"),
      tone: row?.querySelector("[role=status]")?.getAttribute("data-tone") ?? "",
      switchChecked: toggle?.getAttribute("aria-checked") ?? "",
      switchDisabled: toggle === null || toggle === undefined ? true : toggle.disabled === true || toggle.getAttribute("aria-disabled") === "true",
      switchClass: String(toggle?.className ?? ""),
      switchLabel: toggle?.getAttribute("aria-label") ?? "",
      styleLength: row?.querySelector("style")?.textContent?.length ?? 0,
    });
  })()`);
  return JSON.parse(String(raw)) as Awaited<ReturnType<typeof readRow>>;
}

/** Wait until the row is loaded (not busy). */
async function rowSettled(page: Page): Promise<void> {
  await page.locator(`${ROW}[aria-busy="false"]`).waitFor({ state: "visible", timeout: 20_000 });
}

/** Toggle the switch and wait for the row's settled status copy. */
async function toggleAndSettle(page: Page): Promise<string> {
  await page.locator(SWITCH).first().click({ timeout: 10_000 });
  await rowSettled(page);
  return (await readRow(page)).status;
}

/** Bring the persisted switch to `enabled` through the real settings row. */
async function ensureSwitch(enabled: boolean): Promise<void> {
  const page = await newPage();
  await openSettingsSheet(page, live().plane.pageUrl, ROW);
  await rowSettled(page);
  if ((await readRow(page)).switchChecked !== String(enabled)) {
    const status = await toggleAndSettle(page);
    if (status !== copy.saved) throw new Error(`could not set the switch: ${status}`);
  }
  expect((await readRow(page)).switchChecked).toBe(String(enabled));
  await page.context().close();
  contexts = contexts.filter((context) => context !== page.context());
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
  readonly ghostVisible: boolean;
  readonly ghostText: string;
  readonly draft: string;
}

async function readComposer(page: Page): Promise<ComposerContract> {
  const raw: unknown = await page.evaluate(`(() => {
    const anchor = document.querySelector("[data-prompt-suggestions-anchor]");
    const card = anchor?.closest("[data-composer-card]") ?? null;
    const editor = card?.querySelector('[contenteditable="true"]') ?? null;
    const placeholder = card?.querySelector("[data-composer-placeholder]") ?? null;
    const ghost = [...document.querySelectorAll("${GHOST}")].find(
      (element) => element.isConnected && element.style.display !== "none",
    );
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
      ghostVisible: ghost !== undefined,
      ghostText: ghost?.firstElementChild?.textContent ?? "",
      draft: editor?.textContent ?? "",
    });
  })()`);
  return JSON.parse(String(raw)) as ComposerContract;
}

/** Open a fresh session in a workspace no other test uses. */
async function freshSession(): Promise<Page> {
  workspaces += 1;
  const workspace = live().plane.addWorkspace(`dsh-ps-workspace-${String(workspaces)}`);
  const page = await newPage();
  await openLiveSession(page, live().plane.pageUrl, workspace);
  return page;
}

/** Type a prompt into the live composer and send it. */
async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.locator(EDITOR).first().click({ timeout: 10_000 });
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readComposer(page)).draft, { timeout: 10_000 }).toBe("");
}

/** Complete one real turn and wait for the suggestion ghost. */
async function turnWithSuggestion(page: Page): Promise<void> {
  await sendPrompt(page, "Fix the login redirect");
  await expect
    .poll(async () => (await readComposer(page)).ghostText, { timeout: 30_000 })
    .toBe(SUGGESTION);
}

/**
 * Observe a negative condition over a window: something that must *not* happen
 * (a ghost painting, a draft being submitted) has no event to wait for, so the
 * composer is sampled until the window closes.
 */
async function holdsFor(
  page: Page,
  check: (composer: ComposerContract) => boolean,
  what: string,
  forMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + forMs;
  while (Date.now() < deadline) {
    if (!check(await readComposer(page))) throw new Error(`${what} did not hold`);
    await page.waitForTimeout(250);
  }
}

async function ghostStaysHidden(page: Page): Promise<void> {
  await holdsFor(page, (composer) => !composer.ghostVisible, "the ghost staying hidden");
}

describe("settings.general.item in the live General tab", () => {
  it("renders this package's row through the host's slot and Switch primitive", async () => {
    await ensureSwitch(true);
    const page = await newPage();
    await openSettingsSheet(page, live().plane.pageUrl, ROW);
    await rowSettled(page);
    const row = await readRow(page);
    expect(row.rows).toBe(1);
    expect(row.title).toBe(copy.label);
    expect(row.description).toBe(copy.description);
    expect(row.hint).toBe(copy.hint);
    expect(row.switchChecked).toBe("true");
    expect(row.switchDisabled).toBe(false);
    expect(row.switchLabel).toBe(copy.switch);
    // The host renders its own Switch and really styles it: the primitive's CSS
    // module class and this package's injected sheet both reach the live DOM.
    expect(row.switchClass).toMatch(/_switch_[0-9a-z]+_[0-9a-z]+/u);
    expect(row.styleLength).toBeGreaterThan(0);
    await closePages();
  }, 120_000);

  it("writes through the settings service immediately and persists for a new page", async () => {
    await ensureSwitch(true);
    const first = await newPage();
    await openSettingsSheet(first, live().plane.pageUrl, ROW);
    await rowSettled(first);
    expect(await toggleAndSettle(first)).toBe(copy.saved);
    expect((await readRow(first)).tone).toBe("success");

    const second = await newPage();
    await openSettingsSheet(second, live().plane.pageUrl, ROW);
    await rowSettled(second);
    const row = await readRow(second);
    expect(row.switchChecked).toBe("false");
    expect(row.hint).toBe(copy.disabledHint);
    await closePages();
  }, 180_000);

  it("reloads the accepted value after a revision conflict before writing again", async () => {
    await ensureSwitch(true);
    const stale = await newPage();
    await openSettingsSheet(stale, live().plane.pageUrl, ROW);
    await rowSettled(stale);
    const winner = await newPage();
    await openSettingsSheet(winner, live().plane.pageUrl, ROW);
    await rowSettled(winner);
    expect(await toggleAndSettle(winner)).toBe(copy.saved);

    // The stale page still holds the old revision; the real settings service
    // refuses its write and the row reloads what the winner stored.
    expect(await toggleAndSettle(stale)).toBe(copy.conflict);
    const row = await readRow(stale);
    expect(row.switchChecked).toBe("false");
    expect(row.tone).toBe("error");
    // The reload carried the winner's revision, so the next write is accepted
    // instead of conflicting again.
    expect(row.switchDisabled).toBe(false);
    expect(await toggleAndSettle(stale)).toBe(copy.saved);
    expect((await readRow(stale)).switchChecked).toBe("true");
    await closePages();
  }, 180_000);

  it("restores the saved value when the real write fails", async () => {
    await ensureSwitch(true);
    const page = await newPage();
    await openSettingsSheet(page, live().plane.pageUrl, ROW);
    await rowSettled(page);
    // Make the profile directory unwritable so the host's own atomic write of the
    // profile patch fails for real.
    const profile = join(live().plane.home, "profiles", "web");
    chmodSync(profile, 0o555);
    let status: string;
    try {
      status = await toggleAndSettle(page);
    } finally {
      chmodSync(profile, 0o755);
    }
    expect(status).not.toBe(copy.saved);
    expect(status.length).toBeGreaterThan(0);
    const row = await readRow(page);
    expect(row.tone).toBe("error");
    expect(row.switchChecked).toBe("true");
    // The switch stays usable: the next write goes through.
    expect(row.switchDisabled).toBe(false);
    expect(await toggleAndSettle(page)).toBe(copy.saved);
    expect((await readRow(page)).switchChecked).toBe("false");
    await closePages();
  }, 180_000);
});

describe("conversation.input.overlay in a live session", () => {
  it("mounts inside the host composer and paints nothing before a reply", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    const composer = await readComposer(page);
    expect(composer.anchors).toBe(1);
    expect(composer.anchorLabel).toBe(copy.label);
    expect(composer.anchorHidden).toBe(true);
    expect(composer.anchorAriaHidden).toBe("true");
    expect(composer.cardFound).toBe(true);
    expect(composer.editorEditable).toBe("true");
    expect(composer.placeholderText.length).toBeGreaterThan(0);
    expect(composer.placeholderVisibility).toBe("visible");
    expect(composer.ghostVisible).toBe(false);
    // Tab and Escape act only on a visible suggestion.
    await page.locator(EDITOR).first().click({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    expect((await readComposer(page)).draft).toBe("");
    await closePages();
  }, 180_000);

  it("paints the suggestion from a real completed turn over the native placeholder", async () => {
    await ensureSwitch(true);
    const before = script.suggestions.length;
    const page = await freshSession();
    await turnWithSuggestion(page);
    const composer = await readComposer(page);
    expect(composer.placeholderVisibility).toBe("hidden");
    expect(composer.draft).toBe("");
    // Exactly one auxiliary request reached the model, tool-free, at low effort.
    expect(script.suggestions.length).toBe(before + 1);
    const request = script.suggestions.at(-1)!.request.body;
    expect(request["tools"]).toBeUndefined();
    expect(request["reasoning_effort"]).toBe("low");
    await closePages();
  }, 180_000);

  it.each(["Tab", "ArrowRight"])(
    "inserts the suggestion into the draft on %s without sending",
    async (key) => {
      await ensureSwitch(true);
      const page = await freshSession();
      await turnWithSuggestion(page);
      const mains = script.mains.length;
      await page.locator(EDITOR).first().focus();
      await page.keyboard.press(key);
      await expect
        .poll(async () => (await readComposer(page)).draft, { timeout: 5_000 })
        .toBe(SUGGESTION);
      const composer = await readComposer(page);
      expect(composer.ghostVisible).toBe(false);
      // Acceptance fills the draft; it never submits it.
      await holdsFor(
        page,
        (current) => current.draft === SUGGESTION && script.mains.length === mains,
        "the accepted draft staying unsent",
        1_000,
      );
      await closePages();
    },
    180_000,
  );

  it("dismisses on Escape without inserting", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    await page.locator(EDITOR).first().focus();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await readComposer(page)).ghostVisible, { timeout: 5_000 })
      .toBe(false);
    const composer = await readComposer(page);
    expect(composer.draft).toBe("");
    expect(composer.placeholderVisibility).toBe("visible");
    // A dismissed suggestion does not come back for the same reply.
    await page.keyboard.press("Tab");
    expect((await readComposer(page)).draft).toBe("");
    await closePages();
  }, 180_000);

  it("hides while typing and shows the fetched suggestion again once the draft is cleared", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    const suggestions = script.suggestions.length;
    await page.locator(EDITOR).first().focus();
    await page.keyboard.type("x");
    await expect
      .poll(async () => (await readComposer(page)).ghostVisible, { timeout: 5_000 })
      .toBe(false);
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await readComposer(page)).ghostText, { timeout: 5_000 })
      .toBe(SUGGESTION);
    // The ghost came back from the already-fetched answer, not a new model call.
    expect(script.suggestions.length).toBe(suggestions);
    await closePages();
  }, 180_000);

  it("defers Tab while the composer's own popup menu is open", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    // A slash opens the host's command menu; it owns Tab while it is open, and
    // the typed slash also makes the draft non-empty, so nothing is painted.
    await page.locator(EDITOR).first().focus();
    await page.keyboard.type("/");
    await page.locator('[role="listbox"],[role="menu"],[data-trigger-menu]').first().waitFor({
      state: "visible",
      timeout: 10_000,
    });
    expect((await readComposer(page)).ghostVisible).toBe(false);
    await page.keyboard.press("Tab");
    expect((await readComposer(page)).draft).not.toContain(SUGGESTION);
    await closePages();
  }, 180_000);

  it("does not paint while the draft carries an attachment", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    const attachment = join(live().plane.addWorkspace("attachments"), "notes.txt");
    writeFileSync(attachment, "release notes\n");
    // Attach through the composer's own file input, as the host's picker does.
    await page.locator('input[type="file"]').first().setInputFiles(attachment);
    await expect
      .poll(async () => await page.locator("[data-composer-card]").first().textContent(), {
        timeout: 10_000,
      })
      .toContain("notes.txt");
    await expect
      .poll(async () => (await readComposer(page)).ghostVisible, { timeout: 10_000 })
      .toBe(false);
    expect((await readComposer(page)).draft).toBe("");
    await page.locator(EDITOR).first().focus();
    await page.keyboard.press("Tab");
    expect((await readComposer(page)).draft).not.toContain(SUGGESTION);
    await closePages();
  }, 180_000);

  it("does not paint while a turn is running and clears the old suggestion", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    script.holdMain = true;
    try {
      const mains = script.mains.length;
      await sendPrompt(page, "Now add a test");
      await expect.poll(() => script.mains.length, { timeout: 15_000 }).toBeGreaterThan(mains);
      await ghostStaysHidden(page);
    } finally {
      script.holdMain = false;
      for (const exchange of script.held.splice(0)) reply(exchange, "Done.");
    }
    // Once the turn completes the next suggestion paints again.
    await expect
      .poll(async () => (await readComposer(page)).ghostText, { timeout: 30_000 })
      .toBe(SUGGESTION);
    await closePages();
  }, 180_000);

  it("aborts the pending query when the overlay unmounts, cancelling the model call", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    script.holdSuggestion = true;
    try {
      const suggestions = script.suggestions.length;
      // The overlay's query for the finished turn, which the host parks while the
      // held generation is pending.
      const query = page.waitForRequest(
        (request) =>
          request.postData()?.includes("prompt-suggestions/suggest") === true &&
          script.suggestions.length > suggestions,
        { timeout: 30_000 },
      );
      await sendPrompt(page, "Fix the login redirect");
      await expect
        .poll(() => script.suggestions.length, { timeout: 30_000 })
        .toBeGreaterThan(suggestions);
      const pending = script.suggestions.at(-1)!;
      await query;
      // Leaving the session unmounts the overlay; its in-flight query aborts, the
      // host cancels the generation, and the real client hangs up on the model.
      await page.getByRole("button", { name: "New session" }).first().click({ timeout: 10_000 });
      await Promise.race([
        pending.closed,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("the model call was never cancelled")), 20_000),
        ),
      ]);
    } finally {
      script.holdSuggestion = false;
      for (const exchange of script.held.splice(0)) exchange.end();
    }
  }, 180_000);

  it("hides immediately when the settings switch turns off", async () => {
    await ensureSwitch(true);
    const page = await freshSession();
    await turnWithSuggestion(page);
    await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 });
    await page.getByRole("menuitem", { name: "Settings" }).first().click({ timeout: 8_000 });
    await page.locator(ROW).waitFor({ state: "visible", timeout: 15_000 });
    await rowSettled(page);
    expect(await toggleAndSettle(page)).toBe(copy.saved);
    await page.keyboard.press("Escape");
    await page.locator(ROW).waitFor({ state: "detached", timeout: 10_000 });
    expect((await readComposer(page)).ghostVisible).toBe(false);
    expect((await readComposer(page)).placeholderVisibility).toBe("visible");
    await closePages();
  }, 180_000);
});
