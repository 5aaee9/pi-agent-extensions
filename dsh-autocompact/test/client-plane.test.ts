/**
 * Drives this package's client half through the real Harness web plane: the pinned
 * host CLI serves `dsh web` over a throwaway profile, this package is installed into
 * that profile with `dsh plugin --profile web add`, and a real Chromium opens what
 * the host built. The settings navigation, the section slot, the settings service
 * the page reads and writes, the model catalog it offers, the live composer and its
 * `conversation.composer.dock` slot, the session projections and the locale service
 * are the host's own (`docs/conventions.md`, "Tests").
 *
 * Every test boots its own plane, so no test depends on state another left behind.
 * Where a test needs a model, the profile's user patch routes the host's own
 * `@deepseek-ai/dsh-llm-pi-ai` adapter at a locally started OpenAI-compatible
 * server (`model-server.ts`): the reply, its usage and the resulting
 * `contextPressure` projection are produced by the real host stack.
 *
 * Plane boundary, stated rather than substituted: the host renders the
 * `conversation.composer.dock` slot only once a session has left its blank "hero"
 * state (its first turn), so the status entry is asserted after one real turn.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";

import { DICT } from "../src/client/dictionary.ts";
import { LOCAL_MODEL, startModelServer, type ModelServer } from "./model-server.ts";
import {
  assertFreshBuild,
  composerEditor,
  launchBrowser,
  openLiveSession,
  openSettingsSection,
  openWebPlane,
  submitComposer,
  withTeardown,
  type WebPlane,
} from "./web-plane.ts";

const packageDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SECTION = "section.dsha-page";
const STATUS = ".dsha-status";
const copy = DICT["en"] as Record<string, string>;
const ROUTE = `local/${LOCAL_MODEL}`;
/** Prompt-side usage each local reply reports, which the host turns into pressure. */
const PROMPT_TOKENS = 120_000;

let browser: Browser;

beforeAll(async () => {
  // `dsh plugin add` links this directory as it sits on disk.
  assertFreshBuild();
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
}, 30_000);

/** The row the profile's user patch configures for this package. */
interface RowConfig {
  readonly modelLimits?: Readonly<Record<string, number>>;
  readonly defaultLimit?: number;
  readonly enabled?: boolean;
}

/**
 * The profile's user patch layer: a hand-declared `local` route on the host's own
 * pi-ai adapter, selected as the default model, plus this package's row config.
 */
function profilePatch(baseURL: string, row: RowConfig, rowId = "autocompact"): string {
  const lines = [
    "- id: llm-pi-ai",
    "  config:",
    "    providers:",
    "      local:",
    "        displayName: Local Test",
    "        api: openai-completions",
    `        baseURL: ${baseURL}`,
    "        apiKeyEnv: DSHA_LOCAL_KEY",
    "        models:",
    `          - id: ${LOCAL_MODEL}`,
    "            name: Local Model",
    "            contextWindow: 1000000",
    "- id: agent-default-model",
    "  config:",
    "    provider: local",
    `    model: ${LOCAL_MODEL}`,
  ];
  const config = [`    modelLimits: ${JSON.stringify(row.modelLimits ?? {})}`];
  if (row.defaultLimit !== undefined) config.push(`    defaultLimit: ${String(row.defaultLimit)}`);
  if (row.enabled !== undefined) config.push(`    enabled: ${String(row.enabled)}`);
  if (rowId === "autocompact") {
    lines.push("- id: autocompact", "  config:", ...config);
  } else {
    // Mount the row under another entry id, as a composed profile may.
    lines.push(
      "- id: autocompact",
      "  disabled: true",
      "- insert:",
      `    - id: ${rowId}`,
      "      name: '@indexyz/dsh-autocompact'",
      "      config:",
      ...config.map((line) => `    ${line}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

interface Plane {
  readonly web: WebPlane;
  readonly model: ModelServer;
  /** A fresh browser context per page, so no page shares another's state. */
  page(): Promise<Page>;
}

/** Boot one isolated plane (local model, profile patch, web server) for one test. */
async function withPlane(
  row: RowConfig | undefined,
  body: (plane: Plane) => Promise<void>,
  rowId?: string,
): Promise<void> {
  const model = await startModelServer({ promptTokens: PROMPT_TOKENS });
  let web: WebPlane | undefined;
  const contexts: BrowserContext[] = [];
  await withTeardown(async () => {
    web = await openWebPlane({
      sources: [packageDir],
      ...(row === undefined ? {} : { patch: profilePatch(model.baseURL, row, rowId) }),
      env: { DSHA_LOCAL_KEY: "local-test-key" },
    });
    const opened = web;
    await body({
      web: opened,
      model,
      page: async () => {
        const context = await browser.newContext();
        contexts.push(context);
        return await context.newPage();
      },
    });
  }, [
    async () => {
      for (const context of contexts) await context.close();
    },
    async () => await web?.close(),
    async () => await model.close(),
  ]);
}

/** Open this package's section and wait until it has read the host's row. */
async function openSection(page: Page, plane: Plane): Promise<void> {
  await openSettingsSection(page, plane.web.pageUrl, copy["nav"] ?? "", SECTION);
  await page.locator(`${SECTION} [role=switch]`).waitFor({ state: "visible", timeout: 20_000 });
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
  readonly rows: ReadonlyArray<{ route: string; reading: string; value: string }>;
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
      defaultLimit: byLabel(${JSON.stringify(copy["defaultLimit"])}),
      saveDisabled: button(${JSON.stringify(copy["save"])})?.disabled ?? null,
      discardDisabled: button(${JSON.stringify(copy["discard"])})?.disabled ?? null,
      styleLength: (root?.querySelector("style")?.textContent ?? "").length,
      rows: [...(root?.querySelectorAll(".dsha-item") ?? [])]
        .filter((item) => item.querySelector(".dsha-route") !== null)
        .map((item) => ({
          route: item.querySelector(".dsha-route")?.textContent?.trim() ?? "",
          reading: item.querySelector(".dsha-hint")?.textContent?.trim() ?? "",
          value: item.querySelector("input")?.value ?? "",
        })),
    });
  })()`);
  return JSON.parse(String(raw)) as PageSnapshot;
}

/** Poll for the section's settled feedback instead of its transient "Saving…" copy. */
async function settledNotice(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () => await page.locator(`${SECTION} [role=status]`).first().textContent(), {
      timeout: 20_000,
    })
    .toBe(expected);
}

async function switchState(page: Page): Promise<string | null> {
  return await page.locator(`${SECTION} [role=switch]`).first().getAttribute("aria-checked");
}

async function save(page: Page): Promise<void> {
  await page
    .locator(`${SECTION} button`, { hasText: copy["save"] ?? "" })
    .first()
    .click({ timeout: 10_000 });
}

/** Open a session in the plane's workspace and complete one real turn. */
async function completeTurn(page: Page, plane: Plane): Promise<void> {
  await openLiveSession(page, plane.web.pageUrl, plane.web.workspace);
  // A blank session renders the composer as the host's "hero"; the dock slot is
  // not part of it yet.
  expect(await page.locator(STATUS).count()).toBe(0);
  const before = plane.model.completions();
  await submitComposer(page, "hello");
  await expect.poll(() => plane.model.completions(), { timeout: 30_000 }).toBeGreaterThan(before);
  await page.locator("[data-composer-dock]").first().waitFor({ state: "visible", timeout: 30_000 });
}

describe("settings section in the live Settings sheet", () => {
  it("mounts through the host's settings navigation with the package's own controls", async () => {
    await withPlane(undefined, async (plane) => {
      const page = await plane.page();
      await openSection(page, plane);
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
      expect(view.rows).toEqual([]);
      expect(view.saveDisabled).toBe(true);
      expect(view.discardDisabled).toBe(true);
      // The section ships its own stylesheet and the host injects it.
      expect(view.styleLength).toBeGreaterThan(0);
    });
  }, 180_000);

  it("toggles the master switch through the host's settings service and persists it", async () => {
    await withPlane(undefined, async (plane) => {
      const first = await plane.page();
      await openSection(first, plane);
      await first.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
      await expect.poll(async () => await switchState(first), { timeout: 20_000 }).toBe("false");

      const second = await plane.page();
      await openSection(second, plane);
      expect(await switchState(second)).toBe("false");
      await second.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
      await expect.poll(async () => await switchState(second), { timeout: 20_000 }).toBe("true");

      const third = await plane.page();
      await openSection(third, plane);
      expect(await switchState(third)).toBe("true");
    });
  }, 240_000);

  it("saves a deployment threshold through the real settings service and reads it back", async () => {
    await withPlane(undefined, async (plane) => {
      const first = await plane.page();
      await openSection(first, plane);
      await first
        .locator(`${SECTION} input[aria-label="${copy["defaultLimit"] ?? ""}"]`)
        .fill("300k");
      // Staged edits unlock the actions.
      const staged = await readPage(first);
      expect(staged.saveDisabled).toBe(false);
      expect(staged.discardDisabled).toBe(false);
      await save(first);
      await settledNotice(first, copy["saved"] ?? "");
      // The stored form comes back from the host, not from the draft.
      expect((await readPage(first)).defaultLimit).toBe("300000");

      const second = await plane.page();
      await openSection(second, plane);
      expect((await readPage(second)).defaultLimit).toBe("300000");
      // Blank clears the deployment default again, through the same service.
      await second.locator(`${SECTION} input[aria-label="${copy["defaultLimit"] ?? ""}"]`).fill("");
      await save(second);
      await settledNotice(second, copy["saved"] ?? "");

      const third = await plane.page();
      await openSection(third, plane);
      expect((await readPage(third)).defaultLimit).toBe("");
    });
  }, 240_000);

  it("refuses an unparsable threshold instead of writing it", async () => {
    await withPlane(undefined, async (plane) => {
      const page = await plane.page();
      await openSection(page, plane);
      const input = page.locator(`${SECTION} input[aria-label="${copy["defaultLimit"] ?? ""}"]`);
      await input.fill("not-a-count");
      await expect
        .poll(async () => await input.getAttribute("aria-invalid"), { timeout: 10_000 })
        .toBe("true");
      await save(page);
      await settledNotice(page, copy["invalid"] ?? "");
      // Nothing was written: a new page still sees no deployment default.
      const fresh = await plane.page();
      await openSection(fresh, plane);
      expect((await readPage(fresh)).defaultLimit).toBe("");
    });
  }, 180_000);

  it("writes against the revision it read, so a stale page's save is refused and reloads", async () => {
    await withPlane(undefined, async (plane) => {
      const stale = await plane.page();
      await openSection(stale, plane);

      const current = await plane.page();
      await openSection(current, plane);
      await current
        .locator(`${SECTION} input[aria-label="${copy["defaultLimit"] ?? ""}"]`)
        .fill("300k");
      await save(current);
      await settledNotice(current, copy["saved"] ?? "");

      // The stale page still holds the revision it read before that save.
      await stale
        .locator(`${SECTION} input[aria-label="${copy["defaultLimit"] ?? ""}"]`)
        .fill("400k");
      await save(stale);
      await settledNotice(stale, copy["conflict"] ?? "");
      // It reloaded the host's current value instead of overwriting it.
      await expect
        .poll(async () => (await readPage(stale)).defaultLimit, { timeout: 20_000 })
        .toBe("300000");

      const reader = await plane.page();
      await openSection(reader, plane);
      expect((await readPage(reader)).defaultLimit).toBe("300000");
    });
  }, 240_000);

  it("adds and removes a per-model threshold through the host's model catalog", async () => {
    await withPlane({}, async (plane) => {
      const page = await plane.page();
      await openSection(page, plane);
      // The picker lists the route the host's own catalog serves.
      const provider = page.locator(`${SECTION} select[aria-label="${copy["provider"] ?? ""}"]`);
      await provider.selectOption({ label: "Local Test" });
      await page
        .locator(`${SECTION} select[aria-label="${copy["model"] ?? ""}"]`)
        .selectOption({ label: "Local Model" });
      await page.locator(`${SECTION} input[aria-label="${copy["threshold"] ?? ""}"]`).fill("400k");
      await page
        .locator(`${SECTION} button`, { hasText: new RegExp(`^${copy["addAction"] ?? ""}$`) })
        .click({ timeout: 10_000 });
      expect((await readPage(page)).rows).toEqual([
        { route: ROUTE, reading: "400K", value: "400k" },
      ]);
      await save(page);
      await settledNotice(page, copy["saved"] ?? "");

      const reader = await plane.page();
      await openSection(reader, plane);
      expect((await readPage(reader)).rows).toEqual([
        { route: ROUTE, reading: "400K", value: "400000" },
      ]);
      // Removing it unsets the path through the same service.
      await reader
        .locator(`${SECTION} .dsha-item`, { hasText: ROUTE })
        .getByRole("button", { name: copy["remove"] ?? "" })
        .click({ timeout: 10_000 });
      await save(reader);
      await settledNotice(reader, copy["saved"] ?? "");

      const after = await plane.page();
      await openSection(after, plane);
      expect((await readPage(after)).rows).toEqual([]);
    });
  }, 240_000);

  it("reads and writes a row the profile mounts under another entry id", async () => {
    await withPlane(
      { modelLimits: { [ROUTE]: 999_999, "other/route": 1234 } },
      async (plane) => {
        const page = await plane.page();
        await openSection(page, plane);
        // Counts read back in the units the grammar takes: rounding picks the
        // unit (`1M`, never `1000K`) and one decimal reads an uneven count.
        expect((await readPage(page)).rows).toEqual([
          { route: ROUTE, reading: "1M", value: "999999" },
          { route: "other/route", reading: "1.2K", value: "1234" },
        ]);
        // The write addresses the namespace the host reported for the row.
        await page.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
        await expect.poll(async () => await switchState(page), { timeout: 20_000 }).toBe("false");

        const reader = await plane.page();
        await openSection(reader, plane);
        expect(await switchState(reader)).toBe("false");
      },
      "shared-autocompact",
    );
  }, 180_000);
});

describe("composer status entry in the live composer", () => {
  it("reports the session's pressure against the deployment default and opens the section", async () => {
    await withPlane({ defaultLimit: 300_000 }, async (plane) => {
      const page = await plane.page();
      await completeTurn(page, plane);
      const status = page.locator(STATUS);
      // The host writes this pair as `used / capacity`; the pressure comes from the
      // real `contextPressure` projection of the reply's usage.
      await expect
        .poll(async () => await status.locator("span").textContent(), { timeout: 30_000 })
        .toBe("120K / 300K");
      expect(await status.getAttribute("data-state")).toBe("on");
      expect(await status.getAttribute("title")).toBe(
        `${ROUTE}: 120K of 300K\n${copy["dockAction"] ?? ""}`,
      );
      expect(await status.getAttribute("aria-label")).toBe(await status.getAttribute("title"));
      expect(await status.locator("svg").count()).toBe(1);
      // Acting on the reading opens Settings on this package's section.
      await status.click({ timeout: 10_000 });
      await page.locator(`${SECTION} [role=switch]`).waitFor({ state: "visible", timeout: 20_000 });
      const opened = await readPage(page);
      expect(opened.pages).toBe(1);
      expect(opened.title).toBe(copy["title"]);
      expect(opened.defaultLimit).toBe("300000");
    });
  }, 240_000);

  it("prefers the model's own threshold and follows the master switch saved in Settings", async () => {
    await withPlane({ modelLimits: { [ROUTE]: 400_000 }, defaultLimit: 300_000 }, async (plane) => {
      const page = await plane.page();
      await completeTurn(page, plane);
      const status = page.locator(STATUS);
      await expect
        .poll(async () => await status.locator("span").textContent(), { timeout: 30_000 })
        .toBe("120K / 400K");
      // Turning every threshold off in Settings is reported in the live composer.
      await status.click({ timeout: 10_000 });
      await page.locator(`${SECTION} [role=switch]`).waitFor({ state: "visible", timeout: 20_000 });
      await page.locator(`${SECTION} [role=switch]`).first().click({ timeout: 10_000 });
      await expect.poll(async () => await switchState(page), { timeout: 20_000 }).toBe("false");
      await page.keyboard.press("Escape");
      await expect
        .poll(async () => await status.getAttribute("data-state"), { timeout: 20_000 })
        .toBe("off");
      expect(await status.locator("span").textContent()).toBe(copy["dockOff"]);
      expect(await status.getAttribute("title")).toBe(
        `Thresholds are off\n${copy["dockAction"] ?? ""}`,
      );
    });
  }, 240_000);

  it("takes no seat in the ambient row for a model without a threshold", async () => {
    await withPlane({}, async (plane) => {
      const page = await plane.page();
      await completeTurn(page, plane);
      // The dock is mounted (the host's own context meter is in it), and still
      // carries no entry of this package.
      await expect
        .poll(async () => await page.locator("[data-composer-dock]").first().innerText(), {
          timeout: 30_000,
        })
        .toContain("%");
      expect(await page.locator(STATUS).count()).toBe(0);
    });
  }, 240_000);
});

describe("host command in the live web session", () => {
  it("reaches the preset-mounted compaction backend the web profile composes", async () => {
    // The shipped web profile disables the root `compaction-basic` row and mounts
    // compaction inside each agent preset, so a successful `/autocompact` here
    // resolved the backend through the real `agentPresets.serviceFor`, and its
    // retained-budget error reads that backend's own native policy.
    await withPlane({}, async (plane) => {
      const page = await plane.page();
      await completeTurn(page, plane);
      const transcript = page.locator("body");
      await submitComposer(page, "/autocompact 300k");
      await expect
        .poll(async () => await transcript.innerText(), { timeout: 30_000 })
        .toContain(
          `${ROUTE}: autocompact above 300,000 tokens (session). Native automatic compaction: enabled. No configuration written.`,
        );
      await submitComposer(page, "/autocompact 100k");
      await expect
        .poll(async () => await transcript.innerText(), { timeout: 30_000 })
        .toContain("Threshold must be an integer greater than the retained token budget (160000)");
      expect(await composerEditor(page).textContent()).toBe("");
    });
  }, 240_000);
});
