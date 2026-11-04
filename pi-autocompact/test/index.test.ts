import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealPlane, type RealPlane, type RealSession } from "./real-plane.ts";

const MODEL = "probe/compact-model";

/** Seeded below the 300k thresholds the tests set, replied above them: the
 * idle-input path stays out of the way and the real turn boundaries act. */
const ACROSS = { tokens: 250_000, replyTokens: 350_000 } as const;

let plane: RealPlane;

beforeEach(async () => {
  plane = await createRealPlane();
});

afterEach(async () => {
  await plane.close();
});

function compactions(real: RealSession): number {
  return real.session.sessionManager.getBranch().filter((entry) => entry.type === "compaction")
    .length;
}

function lastNotification(real: RealSession): RealSession["notifications"][number] | undefined {
  return real.notifications.at(-1);
}

describe("session-only commands", () => {
  it("preserves earlier boundary metadata and context omissions before its summary", async () => {
    const real = await plane.startSession({
      ...ACROSS,
      precedingExtensions: [
        fileURLToPath(new URL("./fixtures/boundary-proposals.ts", import.meta.url)),
      ],
    });
    await real.command("300k");

    expect(await real.turn()).toHaveLength(1);

    const entries = real.session.sessionManager.getBranch();
    expect(entries.slice(-3).map((entry) => entry.type)).toEqual([
      "custom",
      "context_edit",
      "compaction",
    ]);
    expect(entries.at(-3)).toMatchObject({
      customType: "boundary-probe",
      data: { saved: true },
    });
    const omission = entries.at(-2);
    if (omission?.type !== "context_edit") throw new Error("Expected the preceding context edit");
    expect(omission.replacement).toBeNull();
    expect(real.session.sessionManager.getEntry(omission.targetId)).toBeDefined();
    const projection = real.session.sessionManager.buildSessionProjection();
    expect(
      projection.entries.find((entry) => entry.sourceEntry.id === omission.targetId)?.messages ??
        [],
    ).toEqual([]);
    const summary = plane.server.requests.find((request) => request.summary);
    expect(summary?.body).toBeDefined();
    expect(summary?.body).not.toContain("local summary");
  });

  it("sets model-local overrides, clears them on session start, and never changes model metadata", async () => {
    const real = await plane.startSession(ACROSS);
    const model = real.session.model;
    if (!model) throw new Error("The test session has no model");
    expect(model.contextWindow).toBe(1_000_000);

    await real.command("300k");
    expect(real.session.model).toBe(model);

    // A real turn ends above the threshold: turn_end commits one compaction.
    // agent_before_settle in the same run then sees the compacted, not yet
    // re-measured context and leaves it alone.
    const entries = await real.turn();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Expected a compaction entry");
    expect(entry.details).toEqual({ source: "pi-autocompact" });
    expect(entry.summary).toContain("local summary");
    expect(real.session.sessionManager.getEntry(entry.firstKeptEntryId)).toBeDefined();
    expect(plane.server.summaryRequests()).toBe(1);

    const otherModel = real.session.modelRuntime.getModel("probe", "other-model");
    if (!otherModel) throw new Error("The test models.json is missing probe/other-model");
    await real.session.setModel(otherModel);
    expect(await real.turn()).toEqual([]);

    await real.session.setModel(model);
    // Pi's own reload delivers a real session_start, which drops session overrides.
    await real.reload();
    expect(real.session.model?.contextWindow).toBe(1_000_000);
    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(1);
  });

  it("attempts one boundary only once when its summary fails", async () => {
    const real = await plane.startSession(ACROSS);
    await real.command("300k");
    plane.server.failNextSummary = true;

    // turn_end tries and fails; agent_before_settle reaches the same leaf in the
    // same run and must not ask the summarizer a second time.
    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(1);
    expect(real.notifications.filter((entry) => entry.type === "warning")).toHaveLength(1);

    // The next turn is a new boundary and is attempted again.
    expect(await real.turn()).toHaveLength(1);
  });

  it("off masks the global default, default restores inheritance", async () => {
    await plane.writeGlobalSettings({ piAutocompact: { modelLimits: { [MODEL]: 300_000 } } });
    const real = await plane.startSession(ACROSS);

    // session_start loaded the real settings file.
    expect(await real.turn()).toHaveLength(1);
    expect(plane.server.summaryRequests()).toBe(1);

    await real.command("off");
    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(1);

    await real.command("default");
    expect(await real.turn()).toHaveLength(1);
  });

  it("writes the user model limit only when --save is present", async () => {
    await plane.writeProjectSettings({ theme: "dark" });
    const projectSettings = await plane.readProjectSettings();
    const real = await plane.startSession(ACROSS);
    const untouched = await plane.readGlobalSettings();

    await real.command("300k");
    expect(await plane.readGlobalSettings()).toBe(untouched);
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("No settings written."),
      type: "info",
    });

    await real.command("--save 300k");
    const saved = JSON.parse(await plane.readGlobalSettings()) as {
      piAutocompact?: { modelLimits?: Record<string, number> };
    };
    expect(saved.piAutocompact?.modelLimits).toEqual({ [MODEL]: 300_000 });
    // The command writes the user settings file only.
    expect(await plane.readProjectSettings()).toBe(projectSettings);
    // Pi's own settings reader sees what the command wrote.
    expect(
      SettingsManager.create(plane.projectDir, plane.agentDir).getGlobalSettings(),
    ).toMatchObject({ piAutocompact: { modelLimits: { [MODEL]: 300_000 } } });
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("Saved as the default for this model."),
      type: "info",
    });
    expect(lastNotification(real)?.message).not.toContain("No settings written.");

    expect(await real.turn()).toHaveLength(1);

    await real.command("default");
    expect(lastNotification(real)?.message).toContain("saved model limit 300,000 tokens");
    expect(await real.turn()).toHaveLength(1);
  });

  it("rejects --save without a usable threshold and keeps the previous override", async () => {
    const real = await plane.startSession({ tokens: 280_000 });
    const untouched = await plane.readGlobalSettings();
    await real.command("300k");

    for (const args of ["off --save", "--save", "default --save", "2m --save"]) {
      await real.command(args);
      expect(lastNotification(real)?.type).toBe("error");
      expect(lastNotification(real)?.message).toMatch(/--save|Threshold|context window/);
      expect(await plane.readGlobalSettings()).toBe(untouched);
    }

    const disabled = { compaction: { enabled: false } };
    await plane.writeGlobalSettings(disabled);
    await real.command("250k --save");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("disabled"),
      type: "error",
    });
    expect(JSON.parse(await plane.readGlobalSettings())).toEqual(disabled);

    await plane.writeGlobalSettings({});
    // 280k is below the original 300k override, so the rejected 250k never took effect.
    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(0);
  });

  it("loads a saved model limit on the next session without another command", async () => {
    const first = await plane.startSession(ACROSS);
    await first.command("300k --save");
    const saved = await plane.readGlobalSettings();
    // The saving session does not need a reload.
    expect(await first.turn()).toHaveLength(1);

    const second = await plane.startSession(ACROSS);
    expect(await plane.readGlobalSettings()).toBe(saved);
    expect(await second.turn()).toHaveLength(1);
  });

  it("does not compact below the threshold or when native auto-compaction is disabled", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("400k");
    expect(await real.turn()).toEqual([]);
    expect(plane.server.turnRequests()).toBe(1);
    expect(plane.server.summaryRequests()).toBe(0);

    const disabled = { compaction: { enabled: false } };
    await plane.writeGlobalSettings(disabled);
    await real.reload();
    await real.command("300k");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("disabled"),
      type: "error",
    });
    expect(await real.turn()).toEqual([]);
    expect(JSON.parse(await plane.readGlobalSettings())).toEqual(disabled);
    expect(plane.server.summaryRequests()).toBe(0);
  });

  // An *undefined* usage (`getContextUsage()` returning undefined) is not
  // reachable in the pinned host while a model is selected: Pi returns it only
  // for a model without a positive context window, and its models.json loader
  // rejects such a model ("invalid contextWindow"). The extension's undefined
  // guard is therefore defensive; the reachable unknown state is the null usage
  // of a compacted, not yet re-measured context below.
  it("does not compact again before a compacted context is re-measured", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    await real.session.compact();
    // Pi reports the compacted context as unmeasured until the next reply.
    expect(real.session.getContextUsage()?.tokens).toBeNull();
    expect(compactions(real)).toBe(1);

    // Idle input on the unmeasured context starts no second native compaction.
    // (In JavaScript `null <= limit` holds, so this guards the observable
    // behaviour rather than the explicit null check on its own.)
    plane.server.usageTokens = 10;
    expect(await real.turn()).toEqual([]);
    expect(compactions(real)).toBe(1);
  });

  it("uses native compaction for input while the session is idle", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    // The reply itself is small, so only the input path can compact.
    plane.server.usageTokens = 10;

    expect(await real.turn()).toEqual([]);

    const native = real.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "compaction");
    expect(native).toHaveLength(1);
    expect(plane.server.summaryRequests()).toBe(1);
    // The compaction ran before the prompt reached the model.
    expect(plane.server.requests.map((request) => request.summary)).toEqual([true, false]);
  });

  it("does not start native compaction for input while the session is busy", async () => {
    // Seeded below the threshold, so the first prompt's own idle input passes;
    // that prompt's text then lifts the live context above it while it streams.
    const real = await plane.startSession({ tokens: 250_000, replyTokens: 10 });
    await real.command("300k");

    // Keep a real turn streaming: hold the model reply until the follow-up is queued.
    const release = plane.server.hold();
    const running = real.session.prompt("x".repeat(100_000 * 4));
    await plane.server.waitForRequests(1);
    expect(real.session.isIdle).toBe(false);
    expect(real.session.getContextUsage()?.tokens).toBeGreaterThan(300_000);

    // Input while busy: above the threshold, but Pi is not idle, so no native
    // compaction may start under the running turn.
    await real.session.prompt("second", { streamingBehavior: "followUp" });
    expect(compactions(real)).toBe(0);
    expect(plane.server.summaryRequests()).toBe(0);

    release();
    await running;
    await real.session.waitForIdle();
    expect(compactions(real)).toBe(0);
    expect(plane.server.summaryRequests()).toBe(0);
    // The follow-up was delivered as its own turn.
    expect(plane.server.turnRequests()).toBe(2);
  });

  it("applies project compaction settings over the global default", async () => {
    await plane.writeGlobalSettings({ piAutocompact: { modelLimits: { [MODEL]: 300_000 } } });
    await plane.writeProjectSettings({ compaction: { keepRecentTokens: 50_000 } });
    const real = await plane.startSession(ACROSS);
    expect(await real.turn()).toHaveLength(1);

    await plane.writeProjectSettings({ compaction: { enabled: false } });
    await real.reload();
    expect(await real.turn()).toEqual([]);
  });

  it("leaves the boundary unchanged on a summarizer error", async () => {
    const real = await plane.startSession(ACROSS);
    await real.command("300k");
    plane.server.failNextSummary = true;

    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(1);
    const warning = lastNotification(real);
    expect(warning?.type).toBe("warning");
    expect(warning?.message).toMatch(/^Autocompact failed: /);
    // The real provider's error surfaces in the notice, not a generic message.
    expect(warning?.message).toMatch(/local model failure|500/);
    expect(real.statuses.get("autocompact")).toBeUndefined();
    expect(real.autocompactions()).toEqual([]);
  });
});

describe("provider and global caps", () => {
  it("compacts under a global percentage cap with no model limit", async () => {
    await plane.writeGlobalSettings({ piAutocompact: { globalLimit: "30%" } });
    const real = await plane.startSession(ACROSS);
    expect(await real.turn()).toHaveLength(1);

    await real.command("");
    expect(lastNotification(real)?.message).toContain(
      "autocompact above 300,000 tokens (global cap 30% of the context window)",
    );
  });

  it("lowers a model limit and a session threshold to the provider cap", async () => {
    await plane.writeGlobalSettings({
      piAutocompact: { modelLimits: { [MODEL]: 400_000 }, providerLimits: { probe: 300_000 } },
    });
    const real = await plane.startSession(ACROSS);
    expect(await real.turn()).toHaveLength(1);

    await real.command("500k");
    expect(lastNotification(real)?.message).toContain(
      "autocompact above 300,000 tokens (provider cap 300,000 tokens for probe)",
    );
    expect(await real.turn()).toHaveLength(1);
  });

  it("off ignores caps until default restores them", async () => {
    await plane.writeGlobalSettings({
      piAutocompact: { providerLimits: { probe: 300_000 }, globalLimit: 300_000 },
    });
    const real = await plane.startSession(ACROSS);
    await real.command("off");
    expect(lastNotification(real)?.message).toContain("plugin thresholds off in this session");
    expect(await real.turn()).toEqual([]);

    await real.command("default");
    expect(await real.turn()).toHaveLength(1);
  });

  it.each([
    ["above the context window", 2_000_000, /context window/],
    ["below keepRecentTokens", "1%", /keepRecentTokens/],
  ])("skips a cap %s without a warning", async (_label, globalLimit, reason) => {
    await plane.writeGlobalSettings({ piAutocompact: { globalLimit } });
    const real = await plane.startSession({ tokens: 350_000 });
    expect(await real.turn()).toEqual([]);
    expect(plane.server.summaryRequests()).toBe(0);
    expect(real.notifications.filter((entry) => entry.type !== "info")).toEqual([]);

    await real.command("");
    expect(lastNotification(real)?.message).toMatch(/not used: /);
    expect(lastNotification(real)?.message).toMatch(reason);
  });

  it("saves provider and global caps and applies them at once", async () => {
    await plane.writeGlobalSettings({ theme: "dark" });
    const real = await plane.startSession(ACROSS);

    await real.command("30% --save-provider");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("Saved as the cap for provider probe."),
      type: "info",
    });
    expect(await real.turn()).toHaveLength(1);

    await real.command("--save-global 2m");
    expect(lastNotification(real)?.message).toContain("Saved as the global cap.");
    expect(JSON.parse(await plane.readGlobalSettings())).toEqual({
      theme: "dark",
      piAutocompact: { providerLimits: { probe: "30%" }, globalLimit: 2_000_000 },
    });

    // A later session inherits the saved cap without another command.
    const second = await plane.startSession(ACROSS);
    await second.command("");
    expect(lastNotification(second)?.message).toContain("provider cap 30%");
  });

  it("rejects a cap save when native compaction is disabled or settings are invalid", async () => {
    const disabled = { compaction: { enabled: false } };
    await plane.writeGlobalSettings(disabled);
    const real = await plane.startSession({ tokens: 10 });
    await real.command("80% --save-global");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("disabled"),
      type: "error",
    });
    expect(JSON.parse(await plane.readGlobalSettings())).toEqual(disabled);

    await plane.writeGlobalSettings({ piAutocompact: { providerLimits: [] } });
    const bytes = await plane.readGlobalSettings();
    await real.command("80% --save-provider");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("providerLimits"),
      type: "error",
    });
    expect(await plane.readGlobalSettings()).toBe(bytes);
  });
});
