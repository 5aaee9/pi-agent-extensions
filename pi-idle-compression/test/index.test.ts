import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { createRealPlane, sleep, until, type RealPlane, type RealSession } from "./real-plane.ts";

/** 120 ms: short enough to wait for, long enough to act inside. */
const QUICK = 0.002;
const QUICK_MS = QUICK * 60_000;

let plane: RealPlane;

beforeEach(async () => {
  plane = await createRealPlane();
});

afterEach(async () => {
  await plane.close();
});

function idle(idleMinutes: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { piIdleCompression: { idleMinutes, ...extra } };
}

function messages(real: RealSession, type: "info" | "warning" | "error"): string[] {
  return real.notifications.filter((entry) => entry.type === type).map((entry) => entry.message);
}

describe("Pi extension loading", () => {
  it("registers its command and lifecycle handlers through Pi's real loader", async () => {
    const real = await plane.startSession(0);
    expect(real.session.extensionRunner.getCommand("idle-compression")?.description).toBe(
      "Show idle compaction settings and the time left before it runs",
    );
    const missing = [
      "session_start",
      "session_shutdown",
      "agent_settled",
      "agent_start",
      "input",
      "session_before_compact",
      "session_compact",
      "session_compact_failed",
      "model_select",
    ].filter((event) => !real.session.hasExtensionHandlers(event));
    expect(missing).toEqual([]);
  });
});

describe("idle compaction", () => {
  it("compacts once after the idle time and not again while still idle", async () => {
    await plane.writeGlobalSettings(idle(QUICK));
    const real = await plane.startSession();
    await real.turn();
    expect(real.compactions()).toHaveLength(0);

    await until(() => real.compactions().length === 1);
    await until(() =>
      messages(real, "info").some((text) => text.startsWith("Idle compaction completed")),
    );
    expect(messages(real, "info")[0]).toMatch(/^Idle for \d+s: compacting context/);
    expect(plane.server.summaryRequests()).toBeGreaterThan(0);
    expect(real.statuses.get("idle-compression")).toBeUndefined();

    const summaries = plane.server.summaryRequests();
    await sleep(QUICK_MS * 4);
    expect(real.compactions()).toHaveLength(1);
    expect(plane.server.summaryRequests()).toBe(summaries);
  });

  it("restarts the idle time when a new run begins before it elapses", async () => {
    await plane.writeGlobalSettings(idle(QUICK));
    const real = await plane.startSession();
    await real.turn();

    // A new prompt arrives before the idle time ends; its reply is held well past it.
    const release = plane.server.hold();
    const running = real.turn("again");
    await plane.server.waitForRequests(2);
    await sleep(QUICK_MS * 3);
    expect(real.compactions()).toHaveLength(0);
    expect(plane.server.summaryRequests()).toBe(0);

    release();
    await running;
    // The settled second run starts a fresh idle period.
    await until(() => real.compactions().length === 1);
  });

  it("does not compact on top of a compaction made during the idle period", async () => {
    await plane.writeGlobalSettings(idle(0.01));
    const real = await plane.startSession();
    await real.turn();
    await real.session.compact();
    const summaries = plane.server.summaryRequests();
    expect(real.compactions()).toHaveLength(1);

    await sleep(0.01 * 60_000 * 2);
    expect(real.compactions()).toHaveLength(1);
    expect(plane.server.summaryRequests()).toBe(summaries);
    expect(messages(real, "info")).toEqual([]);
  });

  it("ends the idle period when manual compaction fails and arms after later work", async () => {
    await plane.writeGlobalSettings({ ...idle(0.01), retry: { enabled: false } });
    const real = await plane.startSession();
    await real.turn();
    plane.server.failNextSummary = true;

    await expect(real.session.compact()).rejects.toThrow(/local model failure|500/);
    expect(plane.server.summaryRequests()).toBe(1);
    await sleep(1200);
    expect(real.compactions()).toHaveLength(0);
    expect(plane.server.summaryRequests()).toBe(1);
    expect(messages(real, "info")).toEqual([]);

    await plane.writeGlobalSettings(idle(QUICK));
    await real.turn("new work after the failed compaction");
    await until(() => real.compactions().length === 1);
    expect(plane.server.summaryRequests()).toBe(2);
  });

  it("ends the idle period when manual compaction is cancelled", async () => {
    await plane.writeGlobalSettings(idle(0.01));
    const real = await plane.startSession();
    await real.turn();

    const release = plane.server.hold();
    const compacting = real.session.compact().catch((error: unknown) => error);
    try {
      await plane.server.waitForRequests(2);
      real.session.abortCompaction();
      expect(await compacting).toMatchObject({
        message: expect.stringMatching(/cancelled|aborted/i),
      });
    } finally {
      release();
    }

    await sleep(1200);
    expect(real.compactions()).toHaveLength(0);
    expect(plane.server.summaryRequests()).toBe(1);
    expect(messages(real, "info")).toEqual([]);
  });

  it("ends the idle period when an earlier extension cancels compaction", async () => {
    await plane.writeGlobalSettings(idle(0.01));
    const real = await plane.startSession(100_000, [
      fileURLToPath(new URL("./fixtures/cancel-first-compaction.ts", import.meta.url)),
    ]);
    await real.turn();

    await expect(real.session.compact()).rejects.toThrow("Compaction cancelled");
    await sleep(1200);
    expect(real.compactions()).toHaveLength(0);
    expect(plane.server.summaryRequests()).toBe(0);
    expect(messages(real, "info")).toEqual([]);
  });

  it("arms a resumed conversation from the moment it is opened", async () => {
    await plane.writeGlobalSettings(idle(QUICK));
    // The seed lands after the first session_start; Pi's reload sees it.
    const real = await plane.startSession();
    await sleep(QUICK_MS * 2);
    expect(real.compactions()).toHaveLength(0);

    await real.reload();
    await until(() => real.compactions().length === 1);
  });

  it("releases the timer on shutdown so a reload never compacts twice", async () => {
    await plane.writeGlobalSettings(idle(QUICK));
    const real = await plane.startSession();
    await real.turn();
    // The old instance's timer is pending; reload shuts it down and arms a new one.
    await real.reload();
    await until(() => real.compactions().length === 1);
    await sleep(QUICK_MS * 4);
    expect(real.compactions()).toHaveLength(1);
  });

  it("reports a failed compaction and leaves the context intact", async () => {
    // Without Pi's summary retry the one local failure is final.
    await plane.writeGlobalSettings({ ...idle(QUICK), retry: { enabled: false } });
    const real = await plane.startSession();
    await real.turn();
    plane.server.failNextSummary = true;

    await until(() => messages(real, "warning").length === 1);
    expect(messages(real, "warning")[0]).toMatch(/^Idle compaction failed: /);
    expect(real.compactions()).toHaveLength(0);
    expect(real.statuses.get("idle-compression")).toBeUndefined();
  });
});

describe("layered settings", () => {
  it("prefers the model, then the provider, then the top level", async () => {
    await plane.writeGlobalSettings(
      idle(50, {
        providers: { probe: { idleMinutes: 50 } },
        models: { "probe/compact-model": { idleMinutes: QUICK } },
      }),
    );
    const real = await plane.startSession();
    const other = real.session.modelRuntime.getModel("probe", "other-model");
    if (!other) throw new Error("The test models.json is missing probe/other-model");

    // other-model inherits the provider's 50 minutes.
    await real.session.setModel(other);
    await real.turn();
    await sleep(QUICK_MS * 3);
    expect(real.compactions()).toHaveLength(0);

    // Switching models while idle re-arms with the model's own time, counted
    // from the original idle start, which has already passed.
    const model = real.session.modelRuntime.getModel("probe", "compact-model");
    if (!model) throw new Error("The test models.json is missing probe/compact-model");
    await real.session.setModel(model);
    await until(() => real.compactions().length === 1);
  });

  it("is disabled for one model while others still compact", async () => {
    await plane.writeGlobalSettings(
      idle(QUICK, { models: { "probe/compact-model": { enabled: false } } }),
    );
    const real = await plane.startSession();
    await real.turn();
    await sleep(QUICK_MS * 3);
    expect(real.compactions()).toHaveLength(0);

    const other = real.session.modelRuntime.getModel("probe", "other-model");
    if (!other) throw new Error("The test models.json is missing probe/other-model");
    await real.session.setModel(other);
    await until(() => real.compactions().length === 1);
  });

  it("reports an invalid setting and arms nothing", async () => {
    await plane.writeGlobalSettings(idle(0));
    const real = await plane.startSession();
    await real.turn();
    expect(messages(real, "error")).toEqual([
      "Idle compression settings: piIdleCompression.idleMinutes must be a number of minutes greater than 0 and at most 35791",
    ]);
    await sleep(QUICK_MS * 2);
    expect(real.compactions()).toHaveLength(0);
  });
});

describe("/idle-compression", () => {
  it("reports the effective idle time and what is left", async () => {
    await plane.writeGlobalSettings(idle(10));
    const real = await plane.startSession();
    await real.command();
    expect(real.notifications.at(-1)).toEqual({
      message: "probe/compact-model: compact after 10m idle. No idle period armed.",
      type: "info",
    });

    await real.turn();
    await real.command();
    expect(real.notifications.at(-1)?.message).toMatch(
      /^probe\/compact-model: compact after 10m idle\. Compacts in (10m|9m \d+s) without input\.$/,
    );
    // The command is not input: it neither cancels nor starts compaction.
    expect(real.compactions()).toHaveLength(0);

    await plane.writeGlobalSettings(idle(10, { enabled: false }));
    await real.command();
    expect(real.notifications.at(-1)).toEqual({
      message: "probe/compact-model: idle compression disabled.",
      type: "info",
    });
  });
});
