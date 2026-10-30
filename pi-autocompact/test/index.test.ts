import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealPlane, type RealPlane, type RealSession } from "./real-plane.ts";

const MODEL = "probe/compact-model";

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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The session never reached the expected state");
}

describe("Pi extension loading", () => {
  it("registers its command and boundary handlers through Pi's real loader", async () => {
    const real = await plane.startSession();
    const command = real.session.extensionRunner.getCommand("autocompact");
    expect(command?.description).toBe(
      "Compaction threshold: /autocompact [300k | off | default] [--save]",
    );
    const missing = [
      "session_start",
      "session_shutdown",
      "turn_end",
      "agent_before_settle",
      "input",
    ].filter((event) => !real.session.hasExtensionHandlers(event));
    expect(missing).toEqual([]);
  });
});

describe("session-only commands", () => {
  it("sets model-local overrides, clears them on session start, and never changes model metadata", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    const model = real.session.model;
    if (!model) throw new Error("The test session has no model");
    expect(model.contextWindow).toBe(1_000_000);

    await real.command("300k");
    expect(real.session.model).toBe(model);

    const entries = await real.boundary("turn_end");
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.type).toBe("compaction");
    if (entry?.type !== "compaction") throw new Error("Expected a compaction draft");
    expect(entry.details).toEqual({ source: "pi-autocompact" });
    expect(entry.firstKeptEntryId).not.toBeNull();
    const firstKeptEntryId = entry.firstKeptEntryId;
    if (firstKeptEntryId === null) throw new Error("Expected a kept entry id");
    expect(real.session.sessionManager.getEntry(firstKeptEntryId)).toBeDefined();

    // The same boundary is deduplicated until another command or session start.
    expect(await real.boundary("agent_before_settle")).toEqual([]);

    const otherModel = real.session.modelRuntime.getModel("probe", "other-model");
    if (!otherModel) throw new Error("The test models.json is missing probe/other-model");
    await real.session.setModel(otherModel);
    expect(await real.boundary("turn_end")).toEqual([]);

    await real.session.setModel(model);
    await real.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(real.session.model?.contextWindow).toBe(1_000_000);
    expect(await real.boundary("turn_end")).toEqual([]);
  });

  it("off masks the global default, default restores inheritance", async () => {
    await plane.writeGlobalSettings({ piAutocompact: { modelLimits: { [MODEL]: 300_000 } } });
    const real = await plane.startSession({ tokens: 350_000 });

    // session_start loaded the real settings file.
    expect(await real.boundary("turn_end")).toHaveLength(1);
    expect(plane.server.requests).toHaveLength(1);

    await real.command("off");
    expect(await real.boundary("turn_end")).toEqual([]);
    expect(plane.server.requests).toHaveLength(1);

    await real.command("default");
    expect(await real.boundary("turn_end")).toHaveLength(1);
    expect(plane.server.requests).toHaveLength(2);
  });

  it("writes the user model limit only when --save is present", async () => {
    await plane.writeProjectSettings({ theme: "dark" });
    const projectSettings = await plane.readProjectSettings();
    const real = await plane.startSession({ tokens: 350_000 });
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
      message: expect.stringContaining("Saved as the global default for this model."),
      type: "info",
    });
    expect(lastNotification(real)?.message).not.toContain("No settings written.");

    expect(await real.boundary("turn_end")).toHaveLength(1);

    await real.command("default");
    expect(lastNotification(real)?.message).toContain("global default");
    expect(await real.boundary("turn_end")).toHaveLength(1);
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
    expect(await real.boundary("turn_end")).toEqual([]);
  });

  it("loads a saved model limit on the next session without another command", async () => {
    const first = await plane.startSession({ tokens: 350_000 });
    await first.command("300k --save");
    const saved = await plane.readGlobalSettings();
    // The saving session does not need a reload.
    expect(await first.boundary("turn_end")).toHaveLength(1);

    const second = await plane.startSession({ tokens: 350_000 });
    expect(await plane.readGlobalSettings()).toBe(saved);
    expect(await second.boundary("turn_end")).toHaveLength(1);
  });

  it("does not compact below the threshold or when native auto-compaction is disabled", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("400k");
    expect(await real.boundary("turn_end")).toEqual([]);
    expect(plane.server.requests).toHaveLength(0);

    const disabled = { compaction: { enabled: false } };
    await plane.writeGlobalSettings(disabled);
    await real.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    await real.command("300k");
    expect(lastNotification(real)).toMatchObject({
      message: expect.stringContaining("disabled"),
      type: "error",
    });
    expect(await real.boundary("turn_end")).toEqual([]);
    expect(JSON.parse(await plane.readGlobalSettings())).toEqual(disabled);
    expect(plane.server.requests).toHaveLength(0);
  });

  it("skips unknown usage after a real native compaction", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    await real.session.compact();
    expect(real.session.getContextUsage()?.tokens).toBeNull();
    const afterCompaction = compactions(real);
    expect(afterCompaction).toBe(1);

    expect(await real.boundary("turn_end")).toEqual([]);
    await real.session.extensionRunner.emitInput("hello", undefined, "interactive");
    expect(compactions(real)).toBe(afterCompaction);
  });

  it("uses native compaction for input while the session is idle", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    const before = compactions(real);

    await real.session.extensionRunner.emitInput("hello", undefined, "interactive");

    expect(compactions(real)).toBe(before + 1);
  });

  it("does not start native compaction for input while the session is busy", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    plane.server.delayMs = 120;

    const running = real.session.compact();
    await waitFor(() => !real.session.isIdle);
    await real.session.extensionRunner.emitInput("hello", undefined, "interactive");
    expect(compactions(real)).toBe(0);

    await running;
    expect(compactions(real)).toBe(1);
  });

  it("applies project compaction settings over the global default", async () => {
    await plane.writeGlobalSettings({ piAutocompact: { modelLimits: { [MODEL]: 300_000 } } });
    await plane.writeProjectSettings({ compaction: { keepRecentTokens: 50_000 } });
    const real = await plane.startSession({ tokens: 350_000 });
    expect(await real.boundary("turn_end")).toHaveLength(1);

    await plane.writeProjectSettings({ compaction: { enabled: false } });
    await real.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(await real.boundary("turn_end")).toEqual([]);
  });

  it("leaves the boundary unchanged on a summarizer error", async () => {
    const real = await plane.startSession({ tokens: 350_000 });
    await real.command("300k");
    plane.server.failNextRequest = true;

    expect(await real.boundary("turn_end")).toEqual([]);
    expect(plane.server.requests.length).toBeGreaterThan(0);
    expect(lastNotification(real)?.type).toBe("warning");
    expect(lastNotification(real)?.message).toMatch(/^Autocompact failed: /);
    expect(real.statuses.get("autocompact")).toBeUndefined();
  });
});
