import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getSupportedThinkingLevels,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRelayConfigs } from "../config.ts";
import extension from "../index.ts";
import { chatModels } from "./chat-models.ts";

type Handler = (event: any, ctx: any) => any;
type FetchStub = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

interface Registration {
  name: string;
  config: ProviderConfig;
}

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, any>;
  init: RequestInit | undefined;
}

const BASE = "https://grok.example";
const ENCRYPTED = "reasoning.encrypted_content";
const LOW_TO_XHIGH = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", default: true },
  { value: "xhigh", label: "xHigh" },
];

let stateDir: string;
let configPath: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-xai-"));
  configPath = join(stateDir, "sub2api.json");
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

const writeConfig = (value: unknown) => writeFileSync(configPath, JSON.stringify(value));

function xaiEntry(extra: Record<string, unknown> = {}) {
  return { "zero-aicoding-xai": { baseURL: BASE, token: "sk-grok", api: "xai", ...extra } };
}

function sse(events: readonly object[]) {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function completed(id = "resp_xai", output: object[] = []) {
  return {
    type: "response.completed",
    response: {
      id,
      status: "completed",
      output,
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        total_tokens: 1100,
        input_tokens_details: { cached_tokens: 200 },
      },
    },
  };
}

async function capture(input: URL | RequestInfo, init?: RequestInit): Promise<CapturedRequest> {
  const request = new Request(input, init);
  const text = init?.body === undefined ? "" : await request.clone().text();
  return {
    url: request.url,
    headers: request.headers,
    body: text ? (JSON.parse(text) as Record<string, any>) : {},
    init,
  };
}

// Routes keyed by URL; every other request returns 404.
function stubFetch(routes: Record<string, FetchStub>) {
  const calls: CapturedRequest[] = [];
  vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
    const call = await capture(input, init);
    calls.push(call);
    const route = routes[call.url];
    return route ? route(call.url, init) : new Response(null, { status: 404 });
  });
  return calls;
}

function inventory(models: readonly unknown[]): FetchStub {
  return () => Response.json({ object: "list", data: models });
}

async function load() {
  const registrations: Registration[] = [];
  const commands = new Map<string, Handler>();
  const handlers = new Map<string, Handler[]>();
  const setThinkingLevel = vi.fn<(level: string) => void>();
  await extension({
    registerProvider(name: string, config: ProviderConfig) {
      registrations.push({ name, config });
    },
    registerCommand(name: string, options: { handler: Handler }) {
      commands.set(name, options.handler);
    },
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    setThinkingLevel,
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI);
  const provider = (name: string) => {
    const registration = registrations.findLast((candidate) => candidate.name === name);
    expect(registration).toBeDefined();
    return registration!.config;
  };
  return { registrations, commands, handlers, setThinkingLevel, provider };
}

async function loadProviderComposer() {
  let searchDir = import.meta.dirname;
  while (searchDir !== dirname(searchDir)) {
    const candidate = join(searchDir, "node_modules", "@earendil-works", "pi-coding-agent");
    if (existsSync(candidate)) {
      return import(pathToFileURL(join(candidate, "dist", "core", "provider-composer.js")).href);
    }
    searchDir = dirname(searchDir);
  }
  throw new Error("pi-coding-agent is not installed");
}

interface ComposedProvider {
  getModels(): Model<Api>[];
  streamSimple(
    model: Model<Api>,
    context: ReturnType<typeof normalizeContext>,
    options?: SimpleStreamOptions,
  ): { result(): Promise<AssistantMessage> };
}

// Composes the registration as Pi does, so streams pass through the provider's
// streamSimple and the host Responses adapter.
async function compose(name: string, config: ProviderConfig) {
  const composer = await loadProviderComposer();
  const provider = composer.composeModelProvider(
    name,
    undefined,
    { getProvider: () => undefined },
    config,
  ) as ComposedProvider;
  const model = (id: string) => {
    const found = provider.getModels().find((candidate) => candidate.id === id);
    expect(found).toBeDefined();
    return found!;
  };
  const run = (id: string, context: Context, options: SimpleStreamOptions = {}) =>
    provider
      .streamSimple(model(id), normalizeContext(context), { apiKey: "sk-grok", ...options })
      .result();
  return { provider, model, run };
}

const userTurn = (text: string): Context => ({
  systemPrompt: "You are a test assistant.",
  messages: [{ role: "user", content: text, timestamp: 1 }],
});

describe("xAI entry configuration", () => {
  it("accepts the xAI contract and keeps other entry types unchanged", async () => {
    vi.stubEnv("SUB2API_GROK_TOKEN", "grok-env-token");
    writeConfig({
      grok: {
        baseURL: "https://relay.example/",
        token: "${SUB2API_GROK_TOKEN}",
        api: "xai",
        compress_model: null,
        compress_service_tier: null,
        serverTools: { responses: [], anthropic: [] },
        requestModes: { serviceTier: "fast" },
        modelRequestModes: { "grok-4.7": { daybreak: "blue" } },
      },
      "grok-command": {
        baseURL: "https://relay.example/v1",
        token: "!printf grok-command-token",
        api: "xai",
        serverTools: {},
      },
      responses: {
        baseURL: "https://relay.example",
        token: "sk-responses",
        api: "openai-responses",
        compress_model: "gpt-5-mini",
        serverTools: { responses: [{ type: "web_search" }] },
      },
    });

    const [grok, command, responses] = await loadRelayConfigs(configPath);
    expect(grok).toMatchObject({
      provider: "grok",
      api: "openai-responses",
      xai: true,
      apiKey: "grok-env-token",
      baseUrl: "https://relay.example/v1",
      compressModel: null,
      compressServiceTier: null,
      serverTools: undefined,
      requestModes: { serviceTier: "fast" },
    });
    expect(grok!.modelRequestModes.get("grok-4.7")).toEqual({ daybreak: "blue" });
    expect(command).toMatchObject({
      api: "openai-responses",
      xai: true,
      apiKey: "grok-command-token",
      baseUrl: "https://relay.example/v1",
    });
    expect(responses).toMatchObject({
      api: "openai-responses",
      xai: false,
      compressModel: "gpt-5-mini",
      serverTools: { responses: [{ type: "web_search" }] },
    });
  });

  it.each([
    [{ compress_model: "grok-4.7" }, /^provider grok compress_model is not supported with api xai/],
    [
      { compress_service_tier: "fast" },
      /^provider grok compress_service_tier is not supported with api xai/,
    ],
    [
      { serverTools: { responses: [{ type: "web_search" }] } },
      /^provider grok serverTools are not supported with api xai; hosted tools/,
    ],
    [
      { serverTools: { anthropic: [{ type: "web_search_20260209", name: "web_search" }] } },
      /^provider grok serverTools are not supported with api xai/,
    ],
    [{ serverTools: [] }, /^provider grok serverTools must be an object/],
    [{ token: "" }, /^provider grok is missing token/],
    [{ baseURL: "ftp://relay.example" }, /^provider grok baseURL must use http or https$/],
    [
      { baseURL: "https://user:sk-secret-value@relay.example" },
      /^provider grok baseURL must not include credentials$/,
    ],
    [
      { baseURL: "https://relay.example/v1?key=sk-secret-value" },
      /^provider grok baseURL must not include a query or fragment$/,
    ],
    [{ token: "${SUB2API_MISSING_GROK}" }, /^provider grok token references environment variable/],
    [{ token: "!exit 3" }, /^provider grok token: Credential command failed/],
    [{ requestModes: { serviceTier: "turbo" } }, /^provider grok requestModes.serviceTier/],
  ])("rejects %j with a field-specific, secret-free error", async (extra, message) => {
    writeConfig({
      grok: { baseURL: "https://relay.example", token: "sk-secret-value", api: "xai", ...extra },
    });
    const error = await loadRelayConfigs(configPath).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain("secret-value");
  });

  it("lists xai among the supported api selectors", async () => {
    writeConfig({ grok: { baseURL: "https://relay.example", token: "sk", api: "grok" } });
    await expect(loadRelayConfigs(configPath)).rejects.toThrow(
      'provider grok has unsupported api "grok"; expected one of anthropic-messages, openai-codex-responses, openai-responses, openai-completions, xai',
    );
  });
});

describe("xAI entry registration", () => {
  it("keeps same-host entries' credentials, prices, and failures separate", async () => {
    vi.stubEnv("GROK_A_TOKEN", "sk-grok-a");
    writeConfig({
      "grok-a": { baseURL: "https://relay.example", token: "${GROK_A_TOKEN}", api: "xai" },
      "grok-b": { baseURL: "https://relay.example/v1/", token: "!printf sk-grok-b", api: "xai" },
      "grok-c": { baseURL: "https://relay.example", token: "sk-grok-c", api: "xai" },
      openai: { baseURL: "https://relay.example", token: "sk-openai", api: "openai-responses" },
    });
    const inventories: Record<string, object[]> = {
      "Bearer sk-grok-a": [{ id: "grok-4.7", reasoningEfforts: LOW_TO_XHIGH }],
      "Bearer sk-grok-b": [{ id: "grok-4.7" }],
      "Bearer sk-openai": [{ id: "gpt-5.5" }],
    };
    const multipliers: Record<string, number> = { "Bearer sk-grok-a": 1, "Bearer sk-grok-b": 0.5 };
    const calls: CapturedRequest[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const call = await capture(input, init);
      calls.push(call);
      const auth = call.headers.get("authorization") ?? "";
      if (call.url === "https://relay.example/v1/models") {
        const data = inventories[auth];
        return data ? Response.json({ data }) : Response.json({}, { status: 401 });
      }
      const multiplier = multipliers[auth];
      if (call.url === "https://relay.example/v1/sub2api/billing" && multiplier !== undefined) {
        return Response.json({
          object: "sub2api.key_billing",
          schema_version: 1,
          billing_scope: "token",
          group_rate_multiplier: multiplier,
          resolved_rate_multiplier: multiplier,
          peak_rate_enabled: false,
          effective_rate_multiplier: multiplier,
        });
      }
      return new Response(null, { status: 404 });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const pi = await load();
    expect(pi.registrations.map(({ name }) => name)).toEqual([
      "grok-a",
      "grok-b",
      "grok-c",
      "openai",
    ]);
    for (const [name, apiKey] of [
      ["grok-a", "sk-grok-a"],
      ["grok-b", "sk-grok-b"],
    ] as const) {
      const config = pi.provider(name);
      expect(config).toMatchObject({
        name,
        api: "openai-responses",
        baseUrl: "https://relay.example/v1",
        apiKey,
      });
      expect(config.streamSimple).toBeTypeOf("function");
      expect(chatModels(config.models).map(({ id, api }) => [id, api])).toEqual([
        ["grok-4.7", "openai-responses"],
      ]);
    }
    expect(chatModels(pi.provider("grok-a").models)[0]!.cost).toMatchObject({
      input: 2,
      output: 6,
    });
    expect(chatModels(pi.provider("grok-b").models)[0]!.cost).toMatchObject({
      input: 1,
      output: 3,
      tiers: [{ inputTokensAbove: 200000, input: 2, output: 6 }],
    });
    // An authentication failure stays with its entry; no other credential is tried.
    expect(pi.provider("grok-c").models).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[sub2api:grok-c] failed to fetch models:",
      expect.objectContaining({ message: "HTTP 401" }),
    );
    expect(pi.provider("openai").streamSimple).toBeUndefined();
    expect(
      calls
        .filter(({ url }) => url === "https://relay.example/v1/models")
        .map(({ headers }) => headers.get("authorization"))
        .sort(),
    ).toEqual(["Bearer sk-grok-a", "Bearer sk-grok-b", "Bearer sk-grok-c", "Bearer sk-openai"]);
    // xAI entries never consult the Codex manifest.
    expect(
      calls.filter(
        ({ url, headers }) =>
          url.endsWith("/backend-api/codex/models") &&
          headers.get("authorization") !== "Bearer sk-openai",
      ),
    ).toEqual([]);

    const generation: CapturedRequest[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      generation.push(await capture(input, init));
      return sse([completed()]);
    });
    for (const [name, apiKey] of [
      ["grok-a", "sk-grok-a"],
      ["grok-b", "sk-grok-b"],
    ] as const) {
      const composed = await compose(name, pi.provider(name));
      const result = await composed.run("grok-4.7", userTurn("hi"), { apiKey });
      expect(result).toMatchObject({ provider: name, model: "grok-4.7", stopReason: "stop" });
    }
    expect(generation.map(({ url, headers }) => [url, headers.get("authorization")])).toEqual([
      ["https://relay.example/v1/responses", "Bearer sk-grok-a"],
      ["https://relay.example/v1/responses", "Bearer sk-grok-b"],
    ]);
  });
});

describe("xAI chat inventory", () => {
  it("registers exact chat IDs and excludes Grok media generators", async () => {
    writeConfig(xaiEntry());
    stubFetch({
      [`${BASE}/v1/models`]: inventory([
        { id: "grok-4.6", object: "model", type: "model", display_name: "Grok 4.6" },
        { id: "grok-4.6", display_name: "Duplicate" },
        { id: " grok-padded" },
        { id: "" },
        { id: 42 },
        "not-an-object",
        { id: "gpt-*", display_name: "gpt-*" },
        { id: "composer-2.5", display_name: "composer\u001b[31m-2.5" },
        { id: "xai/grok-4.7" },
        { id: "imagine-v2" },
        { id: "grok-imagine" },
        { id: "grok-imagine-1" },
        { id: "grok-imagine-edit" },
        { id: "grok-video-1.5" },
        { id: "grok-imagine-image-quality", type: "model" },
        { id: "grok-imagine-video-1.5-preview" },
        { id: "xai/grok-imagine-image" },
        { id: "X-AI/Grok-Imagine-Video" },
        { id: "grok/imagine" },
        { id: "grok-imagination-text" },
      ]),
    });
    const pi = await load();
    const models = chatModels(pi.provider("zero-aicoding-xai").models);
    expect(models.map(({ id, name }) => [id, name])).toEqual([
      ["grok-4.6", "Grok 4.6"],
      ["gpt-*", "gpt-*"],
      ["composer-2.5", "composer-2.5"],
      ["xai/grok-4.7", "xai/grok-4.7"],
      ["grok-imagination-text", "grok-imagination-text"],
    ]);
  });

  it.each([
    ["an HTTP error", () => new Response("upstream down", { status: 502 }), "HTTP 502"],
    ["malformed JSON", () => new Response("{", { status: 200 }), "JSON"],
    ["a missing data array", () => Response.json({ models: [] }), "data array"],
    [
      "only media or invalid models",
      () => Response.json({ data: [{ id: "grok-imagine-image" }, { id: "" }] }),
      "no valid chat model IDs",
    ],
  ])("keeps other entries operational after %s", async (_label, route, message) => {
    writeConfig({
      ...xaiEntry(),
      other: { baseURL: "https://other.example", token: "sk-other", api: "openai-responses" },
    });
    stubFetch({
      [`${BASE}/v1/models`]: route,
      "https://other.example/v1/models": inventory([{ id: "grok-4.7" }]),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pi = await load();
    expect(pi.provider("zero-aicoding-xai").models).toEqual([]);
    expect(chatModels(pi.provider("other").models).map(({ id }) => id)).toEqual(["grok-4.7"]);
    expect(consoleError).toHaveBeenCalledWith(
      "[sub2api:zero-aicoding-xai] failed to fetch models:",
      expect.objectContaining({ message: expect.stringContaining(message) }),
    );
  });
});

describe("xAI model metadata", () => {
  it("uses Pi 1.4.0 bundled Grok metadata when the relay omits it", async () => {
    writeConfig(xaiEntry());
    stubFetch({ [`${BASE}/v1/models`]: inventory([{ id: "grok-4.6" }, { id: "grok-4.7" }]) });
    const pi = await load();
    const models = chatModels(pi.provider("zero-aicoding-xai").models);
    expect(models).toHaveLength(2);
    for (const model of models) {
      expect(model).toMatchObject({
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 500000,
        maxTokens: 500000,
        cost: {
          input: 2,
          output: 6,
          cacheRead: 0.5,
          cacheWrite: 0,
          tiers: [{ inputTokensAbove: 200000, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }],
        },
        compat: { supportsLongCacheRetention: false },
      });
      expect(model.thinkingLevelMap).toEqual({
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: null,
      });
    }
  });

  it("applies uniform defaults to IDs absent from xAI catalogs", async () => {
    writeConfig(xaiEntry());
    stubFetch({
      [`${BASE}/v1/models`]: inventory([
        { id: "grok-4.20-0309-reasoning" },
        { id: "xai/grok-4.7" },
        { id: "GROK-4.7" },
        { id: "custom-alias", context_window: 8000 },
      ]),
    });
    const pi = await load();
    const models = chatModels(pi.provider("zero-aicoding-xai").models);
    expect(
      models.map(({ id, reasoning, input, contextWindow, maxTokens, cost, thinkingLevelMap }) => ({
        id,
        reasoning,
        input,
        contextWindow,
        maxTokens,
        cost,
        thinkingLevelMap,
      })),
    ).toEqual(
      (
        [
          ["grok-4.20-0309-reasoning", 200000, 16384],
          ["xai/grok-4.7", 200000, 16384],
          ["GROK-4.7", 200000, 16384],
          ["custom-alias", 8000, 8000],
        ] as const
      ).map(([id, contextWindow, maxTokens]) => ({
        id,
        reasoning: false,
        input: ["text"],
        contextWindow,
        maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        thinkingLevelMap: undefined,
      })),
    );
  });

  it("resolves remote, cached, bundled, and default fields independently", async () => {
    const cachedModel = (model: Record<string, unknown>) => ({
      name: String(model.id),
      provider: "xai",
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
      ...model,
    });
    writeFileSync(
      join(stateDir, "models-store.json"),
      JSON.stringify({
        xai: {
          checkedAt: Date.now(),
          lastModified: Date.now(),
          models: [
            cachedModel({
              id: "grok-4.7",
              reasoning: true,
              input: ["text"],
              contextWindow: 450000,
              maxTokens: 64000,
              cost: { input: 3, output: 9, cacheRead: 0.75, cacheWrite: 0 },
              thinkingLevelMap: { off: "none", minimal: null, low: "low", xhigh: null, max: null },
            }),
            // An explicit all-null map is an empty bound, not missing metadata.
            cachedModel({
              id: "grok-4.5",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 500000,
              maxTokens: 500000,
              cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
              thinkingLevelMap: {
                off: null,
                minimal: null,
                low: null,
                medium: null,
                high: null,
                xhigh: null,
                max: null,
              },
            }),
            cachedModel({
              id: "grok-cache-only",
              reasoning: false,
              input: ["text", "image"],
              contextWindow: 300000,
              maxTokens: 400000,
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
            }),
          ],
        },
      }),
    );
    writeConfig(xaiEntry());
    stubFetch({
      [`${BASE}/v1/models`]: inventory([
        // Remote context (a later valid alias) wins; the cache supplies the rest.
        { id: "grok-4.7", context_window: 0, max_context_tokens: 120000, max_tokens: "" },
        // An oversized remote output limit falls through to bundled data, which
        // does not fit either, so the default cap applies.
        {
          id: "grok-4.6",
          context_window: 100000,
          max_output_tokens: 150000,
          input_modalities: ["text", "audio"],
        },
        // A positive flag establishes reasoning without inventing choices.
        { id: "grok-cache-only", supportsReasoningEffort: true },
        { id: "grok-4.5" },
        // A later remote output alias that fits wins over catalogs and defaults.
        {
          id: "remote-alias",
          context_window: 100000,
          max_tokens: 200000,
          max_output_tokens: 32000,
        },
      ]),
    });
    const pi = await load();
    const [grok47, grok46, cacheOnly, grok45, remoteAlias] = chatModels(
      pi.provider("zero-aicoding-xai").models,
    );
    expect(grok45).toMatchObject({ reasoning: true, cost: { cacheRead: 0.3 } });
    expect(grok45!.thinkingLevelMap).not.toHaveProperty("off");
    expect(getSupportedThinkingLevels(grok45 as unknown as Model<Api>)).toEqual(["off"]);
    expect(remoteAlias).toMatchObject({ contextWindow: 100000, maxTokens: 32000 });
    expect(grok47).toMatchObject({
      contextWindow: 120000,
      maxTokens: 64000,
      input: ["text"],
      reasoning: true,
      cost: { input: 3, output: 9, cacheRead: 0.75 },
      thinkingLevelMap: {
        off: "none",
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
    });
    expect(grok46).toMatchObject({
      contextWindow: 100000,
      maxTokens: 16384,
      input: ["text"],
      reasoning: true,
      cost: { input: 2, output: 6 },
    });
    expect(cacheOnly).toMatchObject({
      contextWindow: 300000,
      maxTokens: 16384,
      input: ["text", "image"],
      reasoning: true,
      cost: { input: 1, output: 2 },
    });
  });
});

describe("xAI reasoning controls", () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    [
      "a published list",
      { id: "grok-4.7", supportsReasoningEffort: true, reasoningEfforts: LOW_TO_XHIGH },
      ["low", "medium", "high", "xhigh"],
    ],
    [
      "a false flag vetoing its list",
      { id: "grok-4.7", supportsReasoningEffort: false, reasoningEfforts: LOW_TO_XHIGH },
      ["off"],
    ],
    [
      "a list on an unknown ID",
      { id: "relay-alias", reasoningEfforts: [{ value: "high" }] },
      ["high"],
    ],
    ["a true flag without choices", { id: "relay-alias", supportsReasoningEffort: true }, ["off"]],
    ["an empty bound", { id: "grok-4.7", reasoningEfforts: [] }, ["off"]],
    [
      "an all-unknown bound",
      { id: "grok-4.7", reasoningEfforts: [{ value: "max" }, { value: "ultra" }] },
      ["off"],
    ],
    [
      "malformed entries",
      {
        id: "relay-alias",
        reasoningEfforts: [{ value: " LOW " }, 42, null, { label: "x" }, "high", { value: "high" }],
      },
      ["low", "high"],
    ],
    [
      "a secondary snake_case list",
      {
        id: "relay-alias",
        reasoningEfforts: "invalid",
        supported_reasoning_levels: ["none", { effort: "Medium" }, "turbo"],
      },
      ["off", "medium"],
    ],
    ["a secondary camelCase list", { id: "grok-4.7", supportedReasoningLevels: ["low"] }, ["low"]],
    [
      "the primary list over a secondary list",
      { id: "grok-4.7", reasoningEfforts: [], supportedReasoningLevels: ["low"] },
      ["off"],
    ],
    [
      "a catalog mapping with explicit none",
      { id: "grok-4.3" },
      ["off", "low", "medium", "high", "xhigh"],
    ],
    ["no reasoning evidence", { id: "relay-alias" }, ["off"]],
  ])("derives Pi's levels from %s", async (_label, item, levels) => {
    writeConfig(xaiEntry());
    stubFetch({ [`${BASE}/v1/models`]: inventory([item]) });
    const pi = await load();
    const composed = await compose("zero-aicoding-xai", pi.provider("zero-aicoding-xai"));
    expect(getSupportedThinkingLevels(composed.model(String(item.id)))).toEqual(levels);
  });

  it("leaves off unset when reasoning has no configurable effort", async () => {
    writeConfig(xaiEntry());
    stubFetch({
      [`${BASE}/v1/models`]: inventory([
        { id: "grok-4.7", supportsReasoningEffort: false },
        { id: "relay-alias", supportsReasoningEffort: true, reasoningEffort: "high" },
        { id: "grok-4.6", reasoningEfforts: [{ value: "none" }] },
      ]),
    });
    const pi = await load();
    const [vetoed, flagged, noneOnly] = chatModels(pi.provider("zero-aicoding-xai").models);
    const disabled = { minimal: null, low: null, medium: null, high: null, xhigh: null, max: null };
    for (const model of [vetoed, flagged]) {
      expect(model!.reasoning).toBe(true);
      expect(model!.thinkingLevelMap).toEqual(disabled);
    }
    expect(noneOnly!.thinkingLevelMap).toEqual({ off: "none", ...disabled });
  });
});

describe("xAI Responses requests", () => {
  async function setup(models: readonly object[]) {
    writeConfig(xaiEntry());
    stubFetch({ [`${BASE}/v1/models`]: inventory(models) });
    const pi = await load();
    const composed = await compose("zero-aicoding-xai", pi.provider("zero-aicoding-xai"));
    const requests: CapturedRequest[] = [];
    const responses: Response[] = [];
    const callerFetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push(await capture(input, init));
      return responses.shift() ?? sse([completed()]);
    });
    return { composed, requests, responses, callerFetch };
  }

  it("sends supported efforts, omits unsupported ones, and keeps encrypted reasoning", async () => {
    const { composed, requests, callerFetch } = await setup([
      { id: "grok-4.7", supportsReasoningEffort: true, reasoningEfforts: LOW_TO_XHIGH },
      { id: "relay-alias", supportsReasoningEffort: true },
      { id: "grok-4.3" },
      { id: "plain-alias" },
    ]);
    const fetch = callerFetch;
    await composed.run("grok-4.7", userTurn("a"), { reasoning: "xhigh", fetch });
    await composed.run("grok-4.7", userTurn("b"), { reasoning: "max", fetch });
    await composed.run("relay-alias", userTurn("c"), { reasoning: "high", fetch });
    await composed.run("relay-alias", userTurn("d"), { fetch });
    // Pi passes no reasoning level when the session is off.
    await composed.run("grok-4.3", userTurn("e"), { fetch });
    await composed.run("plain-alias", userTurn("f"), { fetch });

    expect(requests.map(({ url }) => url)).toEqual(Array(6).fill(`${BASE}/v1/responses`));
    for (const { headers, body, init } of requests) {
      expect(headers.get("authorization")).toBe("Bearer sk-grok");
      expect(init?.redirect).toBe("error");
      expect(body.store).toBe(false);
    }
    const [xhigh, clampedMax, noEffortHigh, noEffortOff, explicitNone, plain] = requests.map(
      ({ body }) => body,
    );
    expect(xhigh).toMatchObject({
      model: "grok-4.7",
      reasoning: { effort: "xhigh" },
      include: [ENCRYPTED],
    });
    expect(clampedMax).toMatchObject({ reasoning: { effort: "xhigh" }, include: [ENCRYPTED] });
    for (const body of [noEffortHigh, noEffortOff]) {
      expect(body).not.toHaveProperty("reasoning");
      expect(body!.include).toEqual([ENCRYPTED]);
    }
    expect(explicitNone).toMatchObject({ reasoning: { effort: "none" }, include: [ENCRYPTED] });
    expect(plain).not.toHaveProperty("reasoning");
    expect(plain).not.toHaveProperty("include");
  });

  it("normalizes after caller hooks and enforces the cache-route opt-out", async () => {
    const { composed, requests, callerFetch } = await setup([
      { id: "grok-4.7", reasoningEfforts: LOW_TO_XHIGH },
    ]);
    const onPayload = vi.fn<NonNullable<SimpleStreamOptions["onPayload"]>>((payload) => ({
      ...(payload as Record<string, unknown>),
      store: true,
      include: ["message.output_text.logprobs", ENCRYPTED],
      reasoning: { effort: "max" },
      metadata: { caller: "hook" },
    }));
    const onResponse = vi.fn<NonNullable<SimpleStreamOptions["onResponse"]>>();
    const result = await composed.run("grok-4.7", userTurn("hello"), {
      reasoning: "high",
      fetch: callerFetch,
      onPayload,
      onResponse,
      headers: { "X-Sub2API-Grok-Client-Tool-Cache": "prefer-cache" },
      sessionId: "session-1",
      cacheRetention: "long",
    });
    expect(result.stopReason).toBe("stop");
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload.mock.calls[0]![0]).toMatchObject({
      model: "grok-4.7",
      reasoning: { effort: "high" },
      include: [ENCRYPTED],
      store: false,
    });
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ id: "grok-4.7", provider: "zero-aicoding-xai" }),
    );
    expect(callerFetch).toHaveBeenCalledTimes(1);
    const [request] = requests;
    expect(request!.headers.get("x-sub2api-grok-client-tool-cache")).toBe("off");
    expect(request!.body).toMatchObject({
      store: false,
      include: ["message.output_text.logprobs", ENCRYPTED],
      metadata: { caller: "hook" },
      prompt_cache_key: "session-1",
    });
    expect(request!.body).not.toHaveProperty("reasoning");
    expect(request!.body).not.toHaveProperty("prompt_cache_retention");
    expect(result.usage.cost.total).toBeGreaterThan(0);
  });

  it("strips hook-added reasoning from models without reasoning", async () => {
    const { composed, requests, callerFetch } = await setup([{ id: "plain-alias" }]);
    await composed.run("plain-alias", userTurn("hello"), {
      fetch: callerFetch,
      onPayload: (payload) => ({
        ...(payload as Record<string, unknown>),
        reasoning: { effort: "high" },
        store: true,
      }),
    });
    expect(requests[0]!.body.store).toBe(false);
    expect(requests[0]!.body).not.toHaveProperty("reasoning");
    expect(requests[0]!.body).not.toHaveProperty("include");
  });

  it("omits 24h retention requested through the environment", async () => {
    vi.stubEnv("PI_CACHE_RETENTION", "long");
    const { composed, requests, callerFetch } = await setup([{ id: "grok-4.7" }]);
    await composed.run("grok-4.7", userTurn("hello"), { sessionId: "s", fetch: callerFetch });
    expect(requests[0]!.body.prompt_cache_key).toBe("s");
    expect(requests[0]!.body).not.toHaveProperty("prompt_cache_retention");
  });

  it("wraps the global fetch when the caller has none and honors cancellation", async () => {
    const { composed } = await setup([{ id: "grok-4.7" }]);
    const calls: CapturedRequest[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push(await capture(input, init));
      return sse([completed()]);
    });
    expect((await composed.run("grok-4.7", userTurn("hello"))).stopReason).toBe("stop");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get("x-sub2api-grok-client-tool-cache")).toBe("off");
    expect(calls[0]!.init?.redirect).toBe("error");

    const controller = new AbortController();
    controller.abort();
    const aborted = await composed.run("grok-4.7", userTurn("stop"), {
      signal: controller.signal,
    });
    expect(aborted.stopReason).toBe("aborted");
  });

  it("keeps local web_search and x_search functions and replays encrypted reasoning", async () => {
    const { composed, requests, responses, callerFetch } = await setup([
      { id: "grok-4.7", reasoningEfforts: LOW_TO_XHIGH },
    ]);
    const reasoningItem = {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "Need search." }],
      encrypted_content: "opaque-reasoning",
    };
    const functionCall = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "web_search",
      arguments: '{"query":"pi"}',
      status: "completed",
    };
    responses.push(
      sse([
        { type: "response.created", response: { id: "resp_1" } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_1", summary: [] },
        },
        { type: "response.output_item.done", output_index: 0, item: reasoningItem },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { ...functionCall, arguments: "" },
        },
        { type: "response.output_item.done", output_index: 1, item: functionCall },
        completed("resp_1", [reasoningItem, functionCall]),
      ]),
    );
    const parameters = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    } as unknown as NonNullable<Context["tools"]>[number]["parameters"];
    const context: Context = {
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "search pi", timestamp: 1 }],
      tools: [
        { name: "web_search", description: "Local web search", parameters },
        { name: "x_search", description: "Local X search", parameters },
      ],
    };
    const first = await composed.run("grok-4.7", context, {
      reasoning: "high",
      fetch: callerFetch,
      headers: { "X-Sub2API-Grok-Client-Tool-Cache": "on" },
    });
    expect(first).toMatchObject({
      provider: "zero-aicoding-xai",
      model: "grok-4.7",
      stopReason: "toolUse",
    });
    const toolCall = first.content.find((block) => block.type === "toolCall");
    expect(toolCall).toMatchObject({ name: "web_search", arguments: { query: "pi" } });

    const second = await composed.run(
      "grok-4.7",
      {
        ...context,
        messages: [
          ...context.messages,
          first,
          {
            role: "toolResult",
            toolCallId: toolCall?.type === "toolCall" ? toolCall.id : "",
            toolName: "web_search",
            content: [{ type: "text", text: "local result" }],
            isError: false,
            timestamp: 2,
          },
        ],
      },
      { reasoning: "high", fetch: callerFetch },
    );
    expect(second).toMatchObject({ provider: "zero-aicoding-xai", stopReason: "stop" });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get("x-sub2api-grok-client-tool-cache")).toBe("off");
      expect(request.body.tools).toEqual([
        expect.objectContaining({ type: "function", name: "web_search" }),
        expect.objectContaining({ type: "function", name: "x_search" }),
      ]);
      expect(request.body.include).toEqual([ENCRYPTED]);
    }
    expect(requests[1]!.body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reasoning", encrypted_content: "opaque-reasoning" }),
        expect.objectContaining({ type: "function_call", call_id: "call_1", name: "web_search" }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_1",
          output: "local result",
        }),
      ]),
    );
  });
});

describe("xAI session contract", () => {
  const relayModel = "gpt-synthetic-a";

  async function setupSession() {
    writeConfig({
      ...xaiEntry({
        requestModes: { serviceTier: "fast", daybreak: "blue" },
        modelRequestModes: { "gpt-5.5": { serviceTier: "ultrafast" } },
      }),
      relay: { baseURL: "https://relay.example", token: "sk-relay", api: "openai-responses" },
      codex: { baseURL: "https://codex.example", token: "sk-codex", api: "openai-codex-responses" },
    });
    stubFetch({
      [`${BASE}/v1/models`]: inventory([{ id: "grok-4.7" }, { id: "gpt-5.5" }]),
      "https://relay.example/v1/models": inventory([{ id: relayModel }]),
      "https://codex.example/backend-api/codex/models": () =>
        Response.json({ models: [{ slug: "gpt-5.5" }] }),
    });
    const pi = await load();
    const notify = vi.fn<(message: string, level: string) => void>();
    const ctx = (provider: string, id: string, api = "openai-responses") => ({
      hasUI: false,
      model: { provider, id, api },
      ui: { notify },
      isIdle: () => true,
      compact: vi.fn<() => void>(),
      sessionManager: { getBranch: () => [], getSessionId: () => "session" },
    });
    const request = (context: ReturnType<typeof ctx>) => {
      let payload: Record<string, unknown> = { model: context.model.id };
      for (const handler of pi.handlers.get("before_provider_request") ?? []) {
        payload = handler({ payload }, context) ?? payload;
      }
      return payload;
    };
    return { pi, notify, ctx, request };
  }

  it("keeps saved modes inactive and rejects mode commands for every xAI model ID", async () => {
    const { pi, notify, ctx, request } = await setupSession();
    const before = readFileSync(configPath, "utf8");
    const registrations = pi.registrations.length;

    for (const id of ["grok-4.7", "gpt-5.5"]) {
      const xai = ctx("zero-aicoding-xai", id);
      expect(request(xai)).toEqual({ model: id });
      for (const command of [
        "toggle-fast",
        "toggle-ultrafast",
        "toggle-daybreak",
        "toggle-ultra",
        "sub2api-save",
      ]) {
        notify.mockClear();
        await pi.commands.get(command)!(command === "sub2api-save" ? "provider" : "", xai);
        expect(notify).toHaveBeenCalledExactlyOnceWith(
          `/${command} is not supported for the selected xAI entry zero-aicoding-xai.`,
          "warning",
        );
      }
      expect(request(xai)).toEqual({ model: id });
    }
    expect(pi.setThinkingLevel).not.toHaveBeenCalled();
    expect(pi.registrations).toHaveLength(registrations);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("keeps another provider's temporary modes across a switch to xAI", async () => {
    const { pi, ctx, request } = await setupSession();
    const relay = ctx("relay", relayModel);
    await pi.commands.get("toggle-fast")!("", relay);
    expect(request(relay)).toEqual({ model: relayModel, service_tier: "priority" });
    expect(request(ctx("zero-aicoding-xai", "grok-4.7"))).toEqual({ model: "grok-4.7" });
    expect(request(relay)).toEqual({ model: relayModel, service_tier: "priority" });
  });

  it("leaves xAI compaction to Pi's textual summary", async () => {
    const { pi, notify, ctx } = await setupSession();
    const xai = ctx("zero-aicoding-xai", "grok-4.7");
    const compactHandlers = pi.handlers.get("session_before_compact") ?? [];
    expect(compactHandlers.length).toBeGreaterThan(0);
    for (const handler of compactHandlers) {
      const result = await handler(
        {
          branchEntries: [],
          customInstructions: undefined,
          preparation: { firstKeptEntryId: "entry", tokensBefore: 1 },
          signal: new AbortController().signal,
        },
        xai,
      );
      expect(result).toBeUndefined();
    }
    await pi.commands.get("openai-compress")!("", xai);
    expect(xai.compact).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "/openai-compress requires a Sub2API OpenAI Codex model.",
      "warning",
    );
  });

  it("shows xAI usage without inactive mode or ultra indicators", async () => {
    const { pi, ctx } = await setupSession();
    const relay = ctx("relay", relayModel);
    await pi.commands.get("toggle-ultra")!("", relay);
    await pi.commands.get("toggle-fast")!("", relay);

    let footer: { render(width: number): string[] } | undefined;
    const theme = { fg: (_color: string, text: string) => text };
    const footerContext = (provider: string, id: string) => ({
      ...ctx(provider, id),
      hasUI: true,
      cwd: join(homedir(), "project"),
      thinkingLevel: "off",
      getContextUsage: () => ({ tokens: 0, contextWindow: 200_000, percent: 0 }),
      sessionManager: { getEntries: () => [], getSessionName: () => undefined },
      ui: {
        theme,
        notify() {},
        setFooter(factory: (...args: any[]) => { render(width: number): string[] }) {
          footer = factory({ requestRender() {} }, theme, {
            getGitBranch: () => null,
            getExtensionStatuses: () => new Map(),
            getAvailableProviderCount: () => 3,
            onBranchChange: () => () => {},
          });
        },
      },
    });
    const render = () => (footer?.render(200) ?? []).at(-1)?.trim();

    const relayFooter = footerContext("relay", relayModel);
    for (const handler of pi.handlers.get("session_start") ?? []) handler({}, relayFooter);
    expect(render()).toBe("relay · loading… [ULTRA ENABLED] [FAST]");

    const xaiFooter = footerContext("zero-aicoding-xai", "gpt-5.5");
    for (const handler of pi.handlers.get("session_start") ?? []) handler({}, xaiFooter);
    expect(render()).toBe("zero-aicoding-xai · loading…");
  });
});
