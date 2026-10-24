import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandDefinition, CommandInvocation } from "@deepseek-ai/dsh-commands";

vi.mock("../compaction.ts", () => ({
  needsCompaction: (measurement: { totalTokens: number }, limit: number) =>
    measurement.totalTokens > limit,
  selectCompactableRange:
    vi.fn<(session: unknown, measurement: unknown, retain: number) => unknown>(),
}));

import { selectCompactableRange } from "../compaction.ts";
import { apply, Config, type AutocompactConfig } from "../index.ts";

function createAgent(sessionId = "session-1", model = "model", scope: object = {}) {
  const session = {
    id: sessionId,
    requestHeader: () => ({ config: { provider: "provider", model, maxTokens: 8000 } }),
  };
  return {
    id: sessionId,
    session,
    // A preset-free fake scope: the registry finds no standing mount for it
    // and the plugin falls back to the Host-plane lookup.
    ctx: scope,
    options: { provider: "provider", model },
  } as unknown as Agent;
}

function createHarness(
  options: {
    pluginConfig?: AutocompactConfig;
    tokens?: number;
    noCapacity?: boolean;
    engine?: Record<string, unknown>;
    noBackend?: boolean;
    presetBackend?: Record<string, unknown>;
    /** How the `agentPresets` service answers. Default: `serviceFor` returns `presetBackend`. */
    presetLookup?: "absent" | "throw";
  } = {},
) {
  const listeners = new Map<string, (payload: any, next: any) => any>();
  const definitions: CommandDefinition[] = [];
  const compactRegion = vi.fn<(start: unknown, end: unknown, agent: unknown) => Promise<unknown>>(
    async () => ({}),
  );
  const engine =
    options.engine ??
    ({
      compactRegion,
      config: { auto: true, retainRatio: 0.16, retainTokens: 20000 },
    } as Record<string, unknown>);
  const serviceFor = vi.fn<(agent: unknown, service: string) => unknown>(
    () => options.presetBackend,
  );
  if (options.presetLookup === "throw") {
    serviceFor.mockImplementation(() => {
      throw new Error("preset scope torn down");
    });
  }
  const ctx = {
    logger: {
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    },
    on: (event: string, listener: (payload: any, next: any) => any) => {
      listeners.set(event, listener);
    },
    effect: (execute: () => unknown) => execute(),
    get: (service: string) => {
      if (service === "agentPresets") {
        if (options.presetLookup === "absent") return undefined;
        return { serviceFor };
      }
      return service === "compaction" && options.noBackend !== true ? engine : undefined;
    },
    commands: {
      register: (definition: CommandDefinition) => {
        definitions.push(definition);
        return () => {};
      },
    },
    tokenMeter: { measure: () => ({ totalTokens: options.tokens ?? 350000 }) },
    llm: {
      resolveModelInfo: async () =>
        options.noCapacity === true
          ? {}
          : { context: { contextWindow: 1_000_000 }, defaultMaxTokens: 8000 },
    },
  };
  apply(ctx as unknown as Context, options.pluginConfig ?? {});
  return { ctx, listeners, definitions, compactRegion, engine, serviceFor };
}

function invocation(agent: Agent, rawInput: string): CommandInvocation {
  return {
    commandId: "command-1" as never,
    agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  };
}

async function step(h: ReturnType<typeof createHarness>, agent: Agent) {
  const next = vi.fn<() => { kind: string; messages: never[] }>(() => ({
    kind: "enter",
    messages: [],
  }));
  const result = await h.listeners.get("agent/pre-step")!(
    { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    next,
  );
  return { next, result };
}

beforeEach(() => {
  vi.mocked(selectCompactableRange).mockReturnValue({ start: 10, end: 20 } as never);
});

describe("session-only thresholds", () => {
  it("registers /autocompact and compacts above the session threshold at a step boundary", async () => {
    const h = createHarness();
    expect(h.definitions[0]?.name).toBe("autocompact");
    expect(h.definitions[0]?.input?.hint).toBe("300k | off | default");

    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "300k"))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("300,000 tokens (session)"),
    });

    const { next } = await step(h, agent);
    expect(next).toHaveBeenCalledOnce();
    expect(h.compactRegion).toHaveBeenCalledOnce();
    expect(h.compactRegion).toHaveBeenCalledWith(10, 20, agent, expect.anything());
  });

  it("does not compact below the threshold or without a threshold", async () => {
    const h = createHarness();
    const agent = createAgent();
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    await h.definitions[0]!.handler(invocation(agent, "400k"));
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("prefers the Agent's preset-mounted backend over the Host plane", async () => {
    const presetCompactRegion = vi.fn<
      (start: unknown, end: unknown, agent: unknown) => Promise<unknown>
    >(async () => ({}));
    const h = createHarness({
      presetBackend: {
        compactRegion: presetCompactRegion,
        config: { auto: true, retainRatio: 0.16, retainTokens: 20000 },
      },
    });
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "300k"));
    await step(h, agent);
    expect(h.serviceFor).toHaveBeenCalledWith(agent, "compaction");
    expect(presetCompactRegion).toHaveBeenCalledOnce();
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("uses the host backend when agentPresets is not mounted", async () => {
    const h = createHarness({ presetLookup: "absent" });
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "300k"));
    await step(h, agent);
    expect(h.serviceFor).not.toHaveBeenCalled();
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("uses the host backend when the preset lookup throws", async () => {
    const h = createHarness({ presetLookup: "throw" });
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "300k"));
    await step(h, agent);
    expect(h.serviceFor).toHaveBeenCalledWith(agent, "compaction");
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("reports a composition that mounts no compaction backend", async () => {
    const h = createHarness({ noBackend: true });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "300k"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("No compaction backend is mounted"),
    });
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("keeps overrides per model and per session", async () => {
    const h = createHarness();
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "300k"));
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();

    // Another model on the same session has no override.
    await step(h, createAgent("session-1", "other-model"));
    expect(h.compactRegion).toHaveBeenCalledOnce();

    // A new session starts clean.
    await step(h, createAgent("session-2"));
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("lets off mask the global default and default restore inheritance", async () => {
    const h = createHarness({
      pluginConfig: { modelLimits: { "provider/model": 300000 } },
    });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "off"))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("backend default compaction"),
    });
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    expect(await h.definitions[0]!.handler(invocation(agent, "default"))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("300,000 tokens (global default)"),
    });
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("rejects a threshold when the mounted backend disables automatic compaction", async () => {
    const h = createHarness({
      engine: { compactRegion: vi.fn<(start: unknown) => void>(), config: { auto: false } },
    });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "300k"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("disabled by the compaction backend"),
    });
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("reports a backend without explicit region compaction", async () => {
    const h = createHarness({ engine: { config: { auto: true } } });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "300k"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("compactRegion"),
    });
    await step(h, agent);
  });

  it("validates the threshold against the retained budget and the real window", async () => {
    const h = createHarness();
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "10k"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("retained token budget"),
    });
    expect(await h.definitions[0]!.handler(invocation(agent, "2m"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("context window"),
    });
    expect(await h.definitions[0]!.handler(invocation(agent, "300kb"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("Usage"),
    });
  });

  it("reports missing model context capacity without compacting", async () => {
    const h = createHarness({ noCapacity: true });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, "300k"))).toMatchObject({
      kind: "error",
      text: expect.stringContaining("No context capacity"),
    });
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("contains a backend failure, warns once, and still reaches the next step", async () => {
    const h = createHarness();
    h.compactRegion.mockRejectedValueOnce(new Error("transport error"));
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "300k"));

    const { next, result } = await step(h, agent);
    expect(next).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: "enter", messages: [] });
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("transport error"));

    await step(h, agent);
    expect(h.ctx.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("applies the deployment default to a model without its own threshold", async () => {
    const h = createHarness({ pluginConfig: { defaultLimit: 300000 } });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, ""))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("300,000 tokens (deployment default)"),
    });
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("lets a per-model default win over the deployment default", async () => {
    const h = createHarness({
      pluginConfig: {
        defaultLimit: 300000,
        modelLimits: { "provider/model": 400000 },
      },
    });
    const agent = createAgent();
    expect(await h.definitions[0]!.handler(invocation(agent, ""))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("400,000 tokens (global default)"),
    });
    // 350,000 measured tokens stay below the 400,000 per-model threshold.
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("lets a session override and off win over the deployment default", async () => {
    const h = createHarness({ pluginConfig: { defaultLimit: 300000 } });
    const agent = createAgent();
    await h.definitions[0]!.handler(invocation(agent, "400k"));
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    expect(await h.definitions[0]!.handler(invocation(agent, "off"))).toMatchObject({
      kind: "success",
      text: expect.stringContaining("backend default compaction"),
    });
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
  });

  it("sees a live Settings write to the deployment default", async () => {
    let defaultLimit: number | undefined;
    const h = createHarness({ pluginConfig: { defaultLimit: { get: () => defaultLimit } } });
    const agent = createAgent();
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    defaultLimit = 300000;
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("does not compact a route whose window the deployment default exceeds", async () => {
    const h = createHarness({
      pluginConfig: { defaultLimit: 1_000_000 },
      tokens: 1_500_000,
    });
    const agent = createAgent();
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("context window"));

    // The warning is once per session, like every other contained failure.
    await step(h, agent);
    expect(h.ctx.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("fails plugin load on an invalid deployment default", () => {
    expect(() => apply({} as unknown as Context, { defaultLimit: 0 })).toThrow(/defaultLimit/);
  });

  it("fails plugin load on an invalid global default", () => {
    expect(() => apply({} as unknown as Context, { modelLimits: { "no-route": 300000 } })).toThrow(
      /Invalid/,
    );
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
    let limits: Record<string, number> = {};
    const h = createHarness({ pluginConfig: { modelLimits: { get: () => limits } } });
    const agent = createAgent();
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    // The Settings page writes the same reference the Loader handed `apply`.
    limits = { "provider/model": 300000 };
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });

  it("honours a master switch flipped through a volatile reference", async () => {
    let enabled = false;
    const h = createHarness({
      pluginConfig: {
        modelLimits: { "provider/model": 300000 },
        enabled: { get: () => enabled },
      },
    });
    const agent = createAgent();
    await step(h, agent);
    expect(h.compactRegion).not.toHaveBeenCalled();

    enabled = true;
    await step(h, agent);
    expect(h.compactRegion).toHaveBeenCalledOnce();
  });
});
