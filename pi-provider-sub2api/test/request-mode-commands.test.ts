import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";

// Synthetic OpenAI-shaped IDs: request assertions are protocol-only.
const A = "gpt-synthetic-a";
const B = "gpt-synthetic-b";
const C = "gpt-synthetic-c";

type Handler = (event: any, ctx: any) => any;
let stateDir: string;
let configPath: string;
let marker: string;

const writeConfig = (value: unknown) => writeFileSync(configPath, JSON.stringify(value));
const readConfig = () => JSON.parse(readFileSync(configPath, "utf8")) as Record<string, any>;
const runs = () => {
  try {
    return readFileSync(marker, "utf8").length;
  } catch {
    return 0;
  }
};

function baseConfig(relay: Record<string, unknown> = {}) {
  return {
    relay: {
      baseURL: "https://relay.example",
      token: `!printf x >> ${marker}; printf relay-token`,
      api: "openai-responses",
      futureSetting: "keep",
      ...relay,
    },
    completions: {
      baseURL: "https://completions.example",
      token: "${SUB2API_COMMANDS_TEST_TOKEN}",
      api: "openai-completions",
    },
  };
}

async function load() {
  const commands = new Map<string, Handler>();
  const completions = new Map<string, (prefix: string) => unknown>();
  const handlers = new Map<string, Handler[]>();
  const registerShortcut = vi.fn<() => void>();
  await extension({
    registerProvider() {},
    registerCommand(
      name: string,
      options: { handler: Handler; getArgumentCompletions?: (prefix: string) => unknown },
    ) {
      commands.set(name, options.handler);
      if (options.getArgumentCompletions) {
        completions.set(name, options.getArgumentCompletions);
      }
    },
    registerShortcut,
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    setThinkingLevel() {},
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI);
  const notify = vi.fn<(message: string, level: string) => void>();
  const ctx = (provider: string, id: string, api = "openai-responses") => ({
    hasUI: false,
    model: { provider, id, api },
    ui: { notify },
  });
  const request = (context: ReturnType<typeof ctx>) => {
    let payload: Record<string, unknown> = { model: context.model.id };
    for (const handler of handlers.get("before_provider_request") ?? []) {
      payload = handler({ payload }, context) ?? payload;
    }
    return payload;
  };
  const run = (name: string, context: unknown, args = "") => commands.get(name)!(args, context);
  return { commands, completions, handlers, registerShortcut, notify, ctx, request, run };
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-mode-commands-"));
  configPath = join(stateDir, "sub2api.json");
  marker = join(stateDir, "credential-runs");
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
  vi.stubEnv("SUB2API_COMMANDS_TEST_TOKEN", "completions-token");
  vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) return Response.json({ data: [{ id: A }, { id: B }] });
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("request mode commands", () => {
  it("registers /sub2api-save without a /save alias or shortcut", async () => {
    writeConfig(baseConfig());
    const pi = await load();
    expect([...pi.commands.keys()]).toEqual(
      expect.arrayContaining([
        "toggle-ultra",
        "toggle-fast",
        "toggle-ultrafast",
        "toggle-daybreak",
        "sub2api-save",
      ]),
    );
    expect(pi.commands.has("save")).toBe(false);
    expect(pi.registerShortcut).not.toHaveBeenCalled();
    const complete = pi.completions.get("sub2api-save")!;
    expect(complete("")).toEqual([{ value: "provider", label: "provider" }]);
    expect(complete("prov")).toEqual([{ value: "provider", label: "provider" }]);
    expect(complete("provider")).toBeNull();
    expect(complete("x")).toBeNull();
  });

  it("toggles in memory only and restores saved state on reload", async () => {
    writeConfig(baseConfig({ requestModes: { serviceTier: "fast" } }));
    const before = readFileSync(configPath, "utf8");
    const pi = await load();
    const a = pi.ctx("relay", A);
    await pi.run("toggle-ultrafast", a);
    await pi.run("toggle-daybreak", a);
    expect(pi.request(a)).toEqual({
      model: A,
      service_tier: "ultrafast",
      access_programs: { cyber: "daybreak_blue" },
    });
    expect(pi.request(pi.ctx("relay", B))).toEqual({ model: B, service_tier: "priority" });
    expect(readFileSync(configPath, "utf8")).toBe(before);

    const reloaded = await load();
    expect(reloaded.request(reloaded.ctx("relay", A))).toEqual({
      model: A,
      service_tier: "priority",
    });
  });

  it("rejects unsupported toggles without changing state", async () => {
    writeConfig(baseConfig());
    const pi = await load();
    const completions = pi.ctx("completions", A, "openai-completions");
    await pi.run("toggle-ultrafast", completions);
    await pi.run("toggle-daybreak", completions);
    await pi.run("toggle-fast", pi.ctx("relay", "grok-synthetic"));
    await pi.run("toggle-fast", pi.ctx("foreign", A));
    await pi.run("toggle-fast", { ui: { notify: pi.notify } });
    expect(pi.notify.mock.calls.map(([, level]) => level)).toEqual(Array(5).fill("warning"));
    expect(pi.request(completions)).toEqual({ model: A });
    await pi.run("toggle-fast", completions);
    expect(pi.request(completions)).toEqual({ model: A, service_tier: "priority" });
  });

  it("saves the current model and restores it in a new instance", async () => {
    writeConfig(
      baseConfig({
        requestModes: { daybreak: "standard" },
        modelRequestModes: { [B]: { serviceTier: "ultrafast" } },
      }),
    );
    const pi = await load();
    expect(runs()).toBe(1);
    const a = pi.ctx("relay", A);
    await pi.run("toggle-fast", a);
    await pi.run("toggle-daybreak", a);
    await pi.run("toggle-ultrafast", pi.ctx("relay", C));
    await pi.run("sub2api-save", a);

    expect(pi.notify).toHaveBeenLastCalledWith(
      `Saved serviceTier fast, daybreak blue for relay/${A}.`,
      "info",
    );
    const expected = baseConfig({
      requestModes: { daybreak: "standard" },
      modelRequestModes: {
        [B]: { serviceTier: "ultrafast" },
        [A]: { serviceTier: "fast", daybreak: "blue" },
      },
    });
    expect(readConfig()).toEqual(expected);
    expect(runs()).toBe(1);

    const reloaded = await load();
    expect(reloaded.request(reloaded.ctx("relay", A))).toEqual({
      model: A,
      service_tier: "priority",
      access_programs: { cyber: "daybreak_blue" },
    });
    expect(reloaded.request(reloaded.ctx("relay", C))).toEqual({
      model: C,
      access_programs: { cyber: "standard" },
    });
  });

  it("saves provider defaults without overriding model entries or other overlays", async () => {
    writeConfig(baseConfig({ modelRequestModes: { [B]: { serviceTier: "default" } } }));
    const pi = await load();
    const a = pi.ctx("relay", A);
    const b = pi.ctx("relay", B);
    await pi.run("toggle-fast", a);
    await pi.run("toggle-daybreak", a);
    await pi.run("toggle-ultrafast", pi.ctx("relay", C));
    await pi.run("sub2api-save", a, " provider ");

    expect(pi.notify).toHaveBeenLastCalledWith(
      "Saved serviceTier fast, daybreak blue as relay defaults; model-specific overrides still take precedence.",
      "info",
    );
    expect(readConfig().relay.requestModes).toEqual({ serviceTier: "fast", daybreak: "blue" });
    expect(readConfig().relay.modelRequestModes).toEqual({ [B]: { serviceTier: "default" } });
    expect(pi.request(b)).toEqual({
      model: B,
      service_tier: "default",
      access_programs: { cyber: "daybreak_blue" },
    });
    expect(pi.request(pi.ctx("relay", C))).toMatchObject({ service_tier: "ultrafast" });
    expect(pi.request(pi.ctx("relay", "gpt-synthetic-new"))).toMatchObject({
      service_tier: "priority",
    });
  });

  it("persists explicit off states and empty snapshots", async () => {
    writeConfig(baseConfig({ requestModes: { serviceTier: "fast", daybreak: "blue" } }));
    const pi = await load();
    const a = pi.ctx("relay", A);
    await pi.run("toggle-fast", a);
    await pi.run("toggle-daybreak", a);
    await pi.run("sub2api-save", a);
    expect(readConfig().relay.modelRequestModes).toEqual({
      [A]: { serviceTier: "default", daybreak: "standard" },
    });
    const reloaded = await load();
    expect(reloaded.request(reloaded.ctx("relay", A))).toEqual({
      model: A,
      service_tier: "default",
      access_programs: { cyber: "standard" },
    });

    writeConfig(baseConfig());
    const empty = await load();
    await empty.run("sub2api-save", empty.ctx("relay", B));
    expect(readConfig().relay.modelRequestModes).toEqual({ [B]: {} });
    expect(empty.notify).toHaveBeenLastCalledWith(`Saved no modes for relay/${B}.`, "info");
  });

  it("saves a Chat Completions model without activating Responses-only modes", async () => {
    writeConfig({
      ...baseConfig(),
      completions: {
        ...baseConfig().completions,
        requestModes: { serviceTier: "ultrafast", daybreak: "blue" },
      },
    });
    const pi = await load();
    const completions = pi.ctx("completions", A, "openai-completions");
    expect(pi.request(completions)).toEqual({ model: A });
    await pi.run("sub2api-save", completions);
    expect(readConfig().completions.modelRequestModes).toEqual({
      [A]: { serviceTier: "ultrafast", daybreak: "blue" },
    });
    expect(readConfig().completions.token).toBe("${SUB2API_COMMANDS_TEST_TOKEN}");
    expect(pi.request(completions)).toEqual({ model: A });
  });

  it.each([
    ["an unknown argument", "relay", A, "openai-responses", "model"],
    ["two arguments", "relay", A, "openai-responses", "provider extra"],
    ["a foreign provider", "foreign", A, "openai-responses", ""],
    ["a non-OpenAI model", "relay", "claude-synthetic", "anthropic-messages", ""],
  ])("rejects %s without writing", async (_name, provider, id, api, args) => {
    writeConfig(baseConfig());
    const before = readFileSync(configPath, "utf8");
    const pi = await load();
    await pi.run("sub2api-save", pi.ctx(provider, id, api), args);
    expect(pi.notify).toHaveBeenCalledTimes(1);
    expect(pi.notify.mock.calls[0]![1]).toBe("warning");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("rejects a missing model without writing", async () => {
    writeConfig(baseConfig());
    const before = readFileSync(configPath, "utf8");
    const pi = await load();
    await pi.run("sub2api-save", { ui: { notify: pi.notify } });
    expect(pi.notify.mock.calls[0]![1]).toBe("warning");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("reports a failed save and keeps temporary state", async () => {
    writeConfig(baseConfig());
    const pi = await load();
    const a = pi.ctx("relay", A);
    await pi.run("toggle-fast", a);
    writeConfig({ completions: baseConfig().completions });
    await pi.run("sub2api-save", a);
    expect(pi.notify).toHaveBeenLastCalledWith(
      `Failed to save request modes for ${A}: provider relay is not an object in the configuration`,
      "error",
    );
    expect(readConfig()).toEqual({ completions: baseConfig().completions });
    expect(pi.request(a)).toEqual({ model: A, service_tier: "priority" });

    writeConfig(baseConfig());
    await pi.run("sub2api-save", a);
    expect(readConfig().relay.modelRequestModes).toEqual({ [A]: { serviceTier: "fast" } });
  });

  it("redraws mode badges for the newly selected model", async () => {
    writeConfig(baseConfig());
    const pi = await load();
    const requestRender = vi.fn<() => void>();
    let render: ((width: number) => string[]) | undefined;
    const footerCtx = {
      ...pi.ctx("relay", A),
      hasUI: true,
      cwd: stateDir,
      thinkingLevel: "off",
      getContextUsage: () => undefined,
      sessionManager: { getEntries: () => [], getSessionName: () => undefined },
      ui: {
        notify: pi.notify,
        theme: { fg: (_color: string, text: string) => text },
        setFooter(factory: any) {
          render = factory(
            { requestRender },
            { fg: (_color: string, text: string) => text },
            {
              getGitBranch: () => undefined,
              getExtensionStatuses: () => new Map(),
              getAvailableProviderCount: () => 1,
              onBranchChange: () => () => {},
            },
          ).render;
        },
      },
    };
    for (const handler of pi.handlers.get("session_start") ?? []) handler({}, footerCtx);
    await vi.waitFor(() => expect(render!(200).at(-1)).toContain("relay"));
    await pi.run("toggle-fast", footerCtx);
    expect(render!(200).at(-1)).toContain("[FAST]");
    requestRender.mockClear();
    footerCtx.model = { provider: "relay", id: B, api: "openai-responses" };
    for (const handler of pi.handlers.get("model_select") ?? []) {
      handler({ model: footerCtx.model }, footerCtx);
    }
    expect(requestRender).toHaveBeenCalled();
    expect(render!(200).at(-1)).not.toContain("[FAST]");
  });
});
