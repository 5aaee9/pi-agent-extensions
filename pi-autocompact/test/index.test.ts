import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  CONFIG_DIR_NAME: ".pi",
  getAgentDir: () => "/agent",
  VERSION: "0.87.1",
}));
vi.mock("../compaction.ts", () => ({
  summarizeBoundary: vi.fn<typeof import("../compaction.ts").summarizeBoundary>(),
}));
vi.mock("../settings.ts", async (original) => ({
  ...(await original<typeof import("../settings.ts")>()),
  readSettings: vi.fn<typeof readSettings>(),
  saveModelLimit: vi.fn<typeof saveModelLimit>(async () => {}),
}));

import plugin from "../index.ts";
import { readSettings, saveModelLimit } from "../settings.ts";
import { summarizeBoundary } from "../compaction.ts";

function harness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  let command: (...args: any[]) => any = () => {};
  plugin({
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    registerCommand: (_name: string, options: { handler: (...args: any[]) => any }) => {
      command = options.handler;
    },
  } as unknown as ExtensionAPI);
  const model = { provider: "provider", id: "model", contextWindow: 1000000 };
  const ctx = {
    model,
    cwd: "/project",
    isProjectTrusted: () => true,
    isIdle: () => true,
    waitForIdle: vi.fn<() => Promise<void>>(async () => {}),
    getContextUsage: vi.fn<() => { tokens: number }>(() => ({ tokens: 350000 })),
    sessionManager: { getLeafId: () => "leaf" },
    ui: {
      notify: vi.fn<ExtensionCommandContext["ui"]["notify"]>(),
      setStatus: vi.fn<ExtensionCommandContext["ui"]["setStatus"]>(),
    },
    compact: vi.fn<ExtensionCommandContext["compact"]>(),
  } as unknown as ExtensionCommandContext;
  return { handlers, command, ctx, model };
}

beforeEach(() => {
  vi.mocked(readSettings).mockResolvedValue({});
  vi.mocked(summarizeBoundary).mockResolvedValue({
    type: "compaction",
    summary: "summary",
    firstKeptEntryId: "keep",
  });
});

describe("session-only commands", () => {
  it("sets model-local overrides, clears them on session start, and never changes model metadata", async () => {
    const { handlers, command, ctx, model } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    expect(model.contextWindow).toBe(1000000);
    const event = { context: {} };
    expect(await handlers.get("turn_end")!(event, ctx)).toMatchObject({
      entries: [{ type: "compaction" }],
    });
    // Deduplicate the same boundary and do not force a continuation.
    expect(await handlers.get("agent_before_settle")!(event, ctx)).toBeUndefined();
    ctx.model = { ...ctx.model!, id: "other-model" };
    expect(await handlers.get("turn_end")!(event, ctx)).toBeUndefined();
    ctx.model = model as ExtensionCommandContext["model"];
    await handlers.get("session_start")!({}, ctx);
    expect(await handlers.get("turn_end")!(event, ctx)).toBeUndefined();
  });
  it("off masks the global default, default restores inheritance", async () => {
    vi.mocked(readSettings).mockImplementation(async (path) =>
      path === "/agent/settings.json"
        ? { piAutocompact: { modelLimits: { "provider/model": 300000 } } }
        : {},
    );
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("off", ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toBeUndefined();
    await command("default", ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toMatchObject({
      entries: [{ type: "compaction" }],
    });
  });
  it("writes the user model limit only when --save is present", async () => {
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    expect(saveModelLimit).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("No settings written."),
      "info",
    );
    await command("--save 300k", ctx);
    expect(saveModelLimit).toHaveBeenCalledExactlyOnceWith(
      "/agent/settings.json",
      "provider/model",
      300000,
    );
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Saved as the global default for this model."),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.not.stringContaining("No settings written."),
      "info",
    );
    await command("default", ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toMatchObject({
      entries: [{ type: "compaction" }],
    });
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("global default"),
      "info",
    );
  });
  it("rejects --save without a usable threshold and keeps the previous override", async () => {
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    for (const args of ["off --save", "--save", "default --save", "2m --save"]) {
      await command(args, ctx);
      expect(ctx.ui.notify).toHaveBeenLastCalledWith(
        expect.stringMatching(/--save|Threshold|context window/),
        "error",
      );
    }
    expect(saveModelLimit).not.toHaveBeenCalled();
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toMatchObject({
      entries: [{ type: "compaction" }],
    });
    await command("300k", ctx);
    vi.mocked(ctx.getContextUsage).mockReturnValue({ tokens: 280000 } as ReturnType<
      typeof ctx.getContextUsage
    >);
    vi.mocked(readSettings).mockResolvedValue({ compaction: { enabled: false } });
    await command("250k --save", ctx);
    expect(saveModelLimit).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("disabled"), "error");
    vi.mocked(readSettings).mockResolvedValue({});
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toBeUndefined();
  });
  it("loads a saved model limit on the next session without another command", async () => {
    vi.mocked(readSettings).mockImplementation(async (path) =>
      path === "/agent/settings.json"
        ? { piAutocompact: { modelLimits: { "provider/model": 300000 } } }
        : {},
    );
    const { handlers, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toMatchObject({
      entries: [{ type: "compaction" }],
    });
    expect(saveModelLimit).not.toHaveBeenCalled();
  });
  it("does not compact below the threshold or when native auto-compaction is disabled", async () => {
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("400k", ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toBeUndefined();
    vi.mocked(readSettings).mockResolvedValue({ compaction: { enabled: false } });
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("disabled"), "error");
  });
  it("skips unknown usage and uses native compaction only for idle input", async () => {
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    vi.mocked(ctx.getContextUsage).mockReturnValue(undefined);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toBeUndefined();
    vi.mocked(ctx.getContextUsage).mockReturnValue({ tokens: 350000 } as ReturnType<
      typeof ctx.getContextUsage
    >);
    vi.mocked(ctx.compact).mockImplementation((options) =>
      options?.onComplete?.({ summary: "native", firstKeptEntryId: "keep", tokensBefore: 350000 }),
    );
    await handlers.get("input")!({}, ctx);
    expect(ctx.compact).toHaveBeenCalledOnce();
    ctx.isIdle = () => false;
    await handlers.get("input")!({}, ctx);
    expect(ctx.compact).toHaveBeenCalledOnce();
  });
  it("leaves the boundary unchanged on a summarizer error", async () => {
    vi.mocked(summarizeBoundary).mockRejectedValue(new Error("transport error"));
    const { handlers, command, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await command("300k", ctx);
    expect(await handlers.get("turn_end")!({ context: {} }, ctx)).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("transport error"),
      "warning",
    );
  });
});
