/**
 * Autocompact behaviour against the real dsh service graph.
 *
 * Each test mounts the pinned host services (`SessionStore`,
 * `SessionProjectionRegistry`, `TokenMeter`, `LlmRuntime`, `CommandRuntime`,
 * `AgentRegistry`, `SystemPrompt`, `ToolsService`, `AgentLoop`) and a real
 * compaction service through `ctx.plugin()`, then mounts the plugin itself as
 * `{ apply, inject, Config }`. Every Agent comes from the real
 * `AgentRegistry.create()`. Commands run through
 * the real command registry (so `command/run` and `command/done` land in the
 * real session log) and the pressure check runs through the real
 * `agent/pre-step` waterfall. Model resolution uses a real `LlmAdapter` that
 * publishes route metadata only; model streaming is credential-gated and is
 * not asserted anywhere (task 4.1).
 */
import { Context } from "@deepseek-ai/cordis";
import { CompactionEngine } from "@deepseek-ai/dsh-compaction";
import { onTestFinished, describe, expect, it } from "vitest";
import { Config } from "../index.ts";
import {
  appendUserMessages,
  createAgent,
  mountRuntime,
  runCommand,
  step,
  switchModel,
  warnings,
  writeLiveConfig,
} from "./host-plane.ts";

const PROVIDER = "provider";
const MODEL = "model";
const ROUTE = `${PROVIDER}/${MODEL}`;

interface HarnessOptions {
  readonly pluginConfig?: Record<string, unknown>;
  readonly contextWindow?: number | undefined;
  readonly backend?: boolean;
  readonly backendConfig?: { auto: boolean; retainRatio?: number; retainTokens?: number };
}

async function harness(options: HarnessOptions = {}) {
  const runtime = await mountRuntime(
    {
      provider: PROVIDER,
      model: MODEL,
      contextWindow: "contextWindow" in options ? options.contextWindow : 1_000_000,
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      ...(options.backendConfig === undefined ? {} : { backendConfig: options.backendConfig }),
    },
    options.pluginConfig ?? {},
  );
  onTestFinished(() => runtime.ctx.fiber.dispose());
  const agent = await createAgent(runtime.ctx, PROVIDER, MODEL);
  return { ...runtime, agent, session: agent.session };
}

describe("session-only thresholds", () => {
  it("registers /autocompact and compacts above the session threshold at a step boundary", async () => {
    const h = await harness();
    const definition = h.ctx.commands.find(h.agent, "autocompact");
    expect(definition?.name).toBe("autocompact");
    expect(definition?.input?.hint).toBe("300k | off | default");

    expect(await runCommand(h.ctx, h.agent, "/autocompact 300k")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("300,000 tokens (session)"),
    });
    // The command is logged by the real command registry; it writes no config.
    expect(h.session.snapshotEvents().map((event) => event.type)).toContain("command/run");

    appendUserMessages(h.session, 8);
    expect(await runCommand(h.ctx, h.agent, "/autocompact 100")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("100 tokens (session)"),
    });

    const result = await step(h.ctx, h.agent);
    expect(result).toEqual({ kind: "enter", messages: [] });
    expect(h.backend?.calls).toHaveLength(1);
    const call = h.backend?.calls[0];
    expect(call?.start).toBe(h.session.surface.nodes[0]);
    expect(call?.end).toBe(h.session.surface.nodes[h.session.surface.nodes.length - 2]);
    expect(call?.agent).toBe(h.agent);
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    // No compaction record was fabricated into the log by the plugin.
    expect(h.session.snapshotEvents().map((event) => event.type)).not.toContain("compaction/start");
  });

  it("does not compact below the threshold or without a threshold", async () => {
    const h = await harness();
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    appendUserMessages(h.session, 4);
    await runCommand(h.ctx, h.agent, "/autocompact 400k");
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
  });

  it("uses the host-plane backend when this composition mounts no preset registry", async () => {
    const h = await harness();
    expect(h.ctx.get("agentPresets")).toBeUndefined();
    appendUserMessages(h.session, 8);
    await runCommand(h.ctx, h.agent, "/autocompact 100");
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("reports a composition that mounts no compaction backend", async () => {
    const h = await harness({ backend: false, pluginConfig: { defaultLimit: 100 } });
    expect(h.ctx.get("compaction")).toBeUndefined();
    expect(await runCommand(h.ctx, h.agent, "/autocompact 300k")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("No compaction backend is mounted for provider/model"),
    });
    // The pressure check still lets the step enter untouched, and has nothing to warn about.
    appendUserMessages(h.session, 8);
    expect(await step(h.ctx, h.agent)).toEqual({ kind: "enter", messages: [] });
    expect(warnings(h.ctx)).toEqual([]);
  });

  it("keeps overrides per model and per session", async () => {
    const h = await harness();
    await runCommand(h.ctx, h.agent, "/autocompact 100");
    appendUserMessages(h.session, 8);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);

    // The session's next request routes to another model: that model has no override.
    switchModel(h.session, PROVIDER, "other-model");
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
    expect(await runCommand(h.ctx, h.agent, "/autocompact")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("provider/other-model: backend default compaction"),
    });

    // A new session (a new Agent from the registry) starts clean.
    const fresh = await createAgent(h.ctx, PROVIDER, MODEL);
    appendUserMessages(fresh.session, 8);
    await step(h.ctx, fresh);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("lets off mask the global default and default restore inheritance", async () => {
    const h = await harness({ pluginConfig: { modelLimits: { [ROUTE]: 100 } } });
    appendUserMessages(h.session, 8);

    expect(await runCommand(h.ctx, h.agent, "/autocompact off")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("backend default compaction"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    expect(await runCommand(h.ctx, h.agent, "/autocompact default")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("100 tokens (global default)"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("rejects a threshold when the mounted backend disables automatic compaction", async () => {
    const h = await harness({
      backendConfig: { auto: false, retainRatio: 0.16, retainTokens: 1 },
    });
    appendUserMessages(h.session, 8);
    expect(await runCommand(h.ctx, h.agent, "/autocompact 100")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("disabled by the compaction backend"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
  });

  it("reports a backend without explicit region compaction", async () => {
    const h = await harness({ backend: false, pluginConfig: { defaultLimit: 100 } });
    // The real abstract seam publishes the `compaction` service without a
    // `compactRegion` implementation, exactly like a backend that predates it.
    await h.ctx
      .plugin(CompactionEngine as unknown as new (ctx: Context) => CompactionEngine)
      .await();
    expect(await runCommand(h.ctx, h.agent, "/autocompact 300k")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("compactRegion"),
    });
    appendUserMessages(h.session, 8);
    await step(h.ctx, h.agent);
    expect(warnings(h.ctx).some((line) => line.includes("compactRegion"))).toBe(true);
  });

  it("validates the threshold against the retained budget and the real window", async () => {
    const h = await harness({
      backendConfig: { auto: true, retainRatio: 0.16, retainTokens: 20000 },
    });
    expect(await runCommand(h.ctx, h.agent, "/autocompact 10k")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("retained token budget"),
    });
    expect(await runCommand(h.ctx, h.agent, "/autocompact 2m")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("context window"),
    });
    expect(await runCommand(h.ctx, h.agent, "/autocompact 300kb")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("Usage"),
    });
  });

  it("reports missing model context capacity without compacting", async () => {
    const h = await harness({ contextWindow: undefined, pluginConfig: { defaultLimit: 100 } });
    appendUserMessages(h.session, 8);
    expect(await runCommand(h.ctx, h.agent, "/autocompact 100")).toMatchObject({
      kind: "error",
      text: expect.stringContaining("No context capacity"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
    expect(warnings(h.ctx).some((line) => line.includes("no context capacity"))).toBe(true);
  });

  it("contains a backend failure, warns once, and still reaches the next step", async () => {
    const h = await harness();
    appendUserMessages(h.session, 8);
    await runCommand(h.ctx, h.agent, "/autocompact 100");
    if (h.backend === undefined) throw new Error("the harness mounted no backend");
    h.backend.failNext = true;

    const result = await step(h.ctx, h.agent);
    expect(result).toEqual({ kind: "enter", messages: [] });
    expect(warnings(h.ctx)).toContainEqual(expect.stringContaining("transport error"));

    await step(h.ctx, h.agent);
    expect(warnings(h.ctx).filter((line) => line.includes("transport error"))).toHaveLength(1);
    expect(h.backend.calls).toHaveLength(1);
  });

  it("applies the deployment default to a model without its own threshold", async () => {
    const h = await harness({ pluginConfig: { defaultLimit: 100 } });
    appendUserMessages(h.session, 8);
    expect(await runCommand(h.ctx, h.agent, "/autocompact")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("100 tokens (deployment default)"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("lets a per-model default win over the deployment default", async () => {
    const h = await harness({
      pluginConfig: { defaultLimit: 50, modelLimits: { [ROUTE]: 100 } },
    });
    appendUserMessages(h.session, 4);
    expect(await runCommand(h.ctx, h.agent, "/autocompact")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("100 tokens (global default)"),
    });
    // Real pressure is above the deployment default but below the per-model one.
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
  });

  it("lets a session override and off win over the deployment default", async () => {
    const h = await harness({ pluginConfig: { defaultLimit: 10 } });
    appendUserMessages(h.session, 4);
    await runCommand(h.ctx, h.agent, "/autocompact 100");
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    expect(await runCommand(h.ctx, h.agent, "/autocompact off")).toMatchObject({
      kind: "success",
      text: expect.stringContaining("backend default compaction"),
    });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
  });

  it("sees a live Settings write to the deployment default", async () => {
    const h = await harness();
    appendUserMessages(h.session, 4);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    // The Settings service writes the same volatile reference the Loader handed
    // `apply`; the plugin re-reads it on every step.
    writeLiveConfig(h.config.defaultLimit, 10);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("does not compact a route whose window the deployment default exceeds", async () => {
    const h = await harness({ contextWindow: 100, pluginConfig: { defaultLimit: 1000 } });
    appendUserMessages(h.session, 60);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);
    expect(warnings(h.ctx).some((line) => line.includes("context window"))).toBe(true);

    // The warning is once per session, like every other contained failure.
    await step(h.ctx, h.agent);
    expect(warnings(h.ctx).filter((line) => line.includes("context window"))).toHaveLength(1);
  });

  it("fails plugin load on an invalid deployment default", async () => {
    await expect(harness({ pluginConfig: { defaultLimit: 0 } })).rejects.toThrow(/defaultLimit/);
  });

  it("fails plugin load on an invalid global default", async () => {
    await expect(
      harness({ pluginConfig: { modelLimits: { "no-route": 300000 } } }),
    ).rejects.toThrow(/Invalid/);
  });

  it("declares the Settings-editable fields volatile", () => {
    // The Host settings service only lists an entry whose schema declares a
    // volatile field, and only accepts writes to volatile paths; without this the
    // Settings page reports the row as not configurable.
    expect(Config.dict?.modelLimits?.meta?.volatile).toBe(true);
    expect(Config.dict?.defaultLimit?.meta?.volatile).toBe(true);
    expect(Config.dict?.enabled?.meta?.volatile).toBe(true);
    expect(Config.dict?.retainTokens?.meta?.volatile).toBeUndefined();
  });

  it("sees a live Settings write through the volatile references", async () => {
    const h = await harness();
    appendUserMessages(h.session, 4);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    // The Settings page writes the same reference the Loader handed `apply`.
    writeLiveConfig(h.config.modelLimits, { [ROUTE]: 10 });
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });

  it("honours a master switch flipped through a volatile reference", async () => {
    const h = await harness({
      pluginConfig: { modelLimits: { [ROUTE]: 10 }, enabled: false },
    });
    appendUserMessages(h.session, 4);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(0);

    writeLiveConfig(h.config.enabled, true);
    await step(h.ctx, h.agent);
    expect(h.backend?.calls).toHaveLength(1);
  });
});
