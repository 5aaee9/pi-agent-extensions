import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CodexStream = (
  model: Record<string, any>,
  context: Record<string, any>,
  options: Record<string, any>,
) => AsyncIterable<unknown>;

const codexApiMock = vi.hoisted(() => ({
  streamSimple: vi.fn<CodexStream>(),
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
  openAICodexResponsesApi: () => ({
    streamSimple: (...args: Parameters<CodexStream>) => codexApiMock.streamSimple(...args),
  }),
}));

const { default: extension } = await import("../index.ts");

interface Registration {
  name: string;
  config: ProviderConfig;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface CodexCall {
  model: Record<string, any>;
  context: Record<string, any>;
  options: Record<string, any>;
}

const specialToken = "!literal$TOKEN${OTHER}$$tail";
const relayDefinitions = {
  "fallback-relay": {
    baseURL: "https://fallback.example",
    token: "sk-fallback",
  },
  "中继-codex": {
    baseURL: "http://codex.example/v1/",
    token: specialToken,
    api: "openai-codex-responses",
  },
  "anthropic-only": {
    baseURL: "https://anthropic.example/v1",
    token: "sk-anthropic",
    api: "anthropic-messages",
  },
  "responses-only": {
    baseURL: "https://responses.example",
    token: "sk-responses",
    api: "openai-responses",
  },
  "completions-only": {
    baseURL: "http://v1",
    token: "sk-completions",
    api: "openai-completions",
  },
};
const discovery = {
  "https://fallback.example/v1/models": {
    token: "sk-fallback",
    models: [
      {
        id: "gpt-5.5",
        display_name: "GPT-5.5",
        context_window: 250000,
        max_tokens: 32000,
      },
      { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
      { id: "grok-4-fast", display_name: "Grok 4 Fast" },
      { id: "gpt-image-1", display_name: "GPT Image" },
    ],
  },
  "http://codex.example/v1/models": {
    token: specialToken,
    models: [{ id: "claude-forced-codex", display_name: "Forced Codex" }],
  },
  "https://anthropic.example/v1/models": {
    token: "sk-anthropic",
    models: [
      { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
      { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
    ],
  },
  "https://responses.example/v1/models": {
    token: "sk-responses",
    models: [{ id: "gpt-5.5-forced-responses", display_name: "Forced Responses" }],
  },
  "http://v1/v1/models": {
    token: "sk-completions",
    models: [{ id: "claude-forced-completions", display_name: "Forced Completions" }],
  },
} as const;

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-test-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  codexApiMock.streamSimple.mockReset();
  rmSync(stateDir, { recursive: true, force: true });
});

function modelConfigs(registration: Registration) {
  expect(registration.config.models).toBeDefined();
  return registration.config.models!;
}

async function registerProviders() {
  const registrations: Registration[] = [];
  await extension({
    registerProvider(name: string, config: ProviderConfig) {
      registrations.push({ name, config });
    },
  } as unknown as ExtensionAPI);
  return registrations;
}

function decodeCodexAccountId(token: string) {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64").toString("utf8"),
  ) as Record<string, { chatgpt_account_id: string }>;
  return payload["https://api.openai.com/auth"]!.chatgpt_account_id;
}

async function collectStream(stream: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

function createDoneEvent(model: Record<string, any>) {
  return {
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

async function loadProviderComposer() {
  let searchDir = import.meta.dirname;
  let codingAgentDir: string | undefined;
  while (searchDir !== dirname(searchDir)) {
    const candidate = join(searchDir, "node_modules", "@earendil-works", "pi-coding-agent");
    if (existsSync(candidate)) {
      codingAgentDir = candidate;
      break;
    }
    searchDir = dirname(searchDir);
  }
  expect(codingAgentDir).toBeDefined();

  const providerComposer = await import(
    pathToFileURL(join(codingAgentDir!, "dist", "core", "provider-composer.js")).href
  );
  const { resolveConfigValue } = await import(
    pathToFileURL(join(codingAgentDir!, "dist", "core", "resolve-config-value.js")).href
  );
  return { providerComposer, resolveConfigValue };
}

describe("sub2api provider extension", () => {
  it("registers native Anthropic, Codex, Responses, and Completions model APIs", async () => {
    writeFileSync(join(stateDir, "sub2api.json"), JSON.stringify(relayDefinitions));

    const modelFetchCalls: FetchCall[] = [];
    const transportFetchCalls: FetchCall[] = [];
    const customFetchCalls: FetchCall[] = [];
    const codexCalls: CodexCall[] = [];
    const codexProviders = new Set(["fallback-relay", "中继-codex"]);

    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const discovered = discovery[url as keyof typeof discovery];
      if (discovered) {
        modelFetchCalls.push({ url, init });
        return Response.json({ data: discovered.models });
      }

      transportFetchCalls.push({ url, init });
      return Response.json(
        { error: { type: "invalid_request_error", message: "intentional test stop" } },
        { status: 400 },
      );
    });

    codexApiMock.streamSimple.mockImplementation(
      (model: Record<string, any>, context: Record<string, any>, options: Record<string, any>) => {
        codexCalls.push({ model, context, options });
        return (async function* () {
          if (codexProviders.has(String(model.provider))) {
            expect(options.transport).toBe("sse");
            expect(options.fetch).toBeTypeOf("function");
            await options.fetch(`${model.baseUrl}/codex/responses`, {
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                "chatgpt-account-id": decodeCodexAccountId(options.apiKey),
                "OpenAI-Beta": "responses=experimental",
              },
            });
          }
          yield createDoneEvent(model);
        })();
      },
    );

    const registrations = await registerProviders();
    expect(modelFetchCalls.map((call) => call.url)).toEqual(Object.keys(discovery));
    for (const call of modelFetchCalls) {
      const discovered = discovery[call.url as keyof typeof discovery];
      expect(new Headers(call.init?.headers).get("authorization")).toBe(
        `Bearer ${discovered.token}`,
      );
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call.init?.signal?.aborted).toBe(false);
    }
    expect(registrations.map((registration) => registration.name)).toEqual(
      Object.keys(relayDefinitions),
    );

    const fallback = registrations[0]!;
    const fallbackModels = modelConfigs(fallback);
    expect(fallback.config).toMatchObject({
      baseUrl: "https://fallback.example/v1",
      apiKey: "sk-fallback",
      api: "openai-codex-responses",
    });
    expect(fallback.config.streamSimple).toBeTypeOf("function");
    expect(fallbackModels.map((model) => [model.id, model.api, model.baseUrl])).toEqual([
      ["gpt-5.5", "openai-codex-responses", "https://fallback.example/v1"],
      ["claude-opus-4-6", "anthropic-messages", "https://fallback.example"],
      ["grok-4-fast", "openai-responses", "https://fallback.example/v1"],
    ]);
    expect(fallbackModels[0]!.headers).toEqual({ Authorization: "Bearer sk-fallback" });
    expect(fallbackModels[1]!.headers).toBeUndefined();
    expect(fallbackModels[2]!.headers).toBeUndefined();
    expect(fallbackModels[0]).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: "none", xhigh: "xhigh" },
      contextWindow: 250000,
      maxTokens: 32000,
    });
    expect(fallbackModels[1]!.compat).toEqual({ forceAdaptiveThinking: true });
    expect(fallbackModels[1]!.thinkingLevelMap).toEqual({ xhigh: "max" });
    expect(fallbackModels[2]!.reasoning).toBe(false);

    const forcedCodex = registrations[1]!;
    const forcedCodexModel = modelConfigs(forcedCodex)[0]!;
    const { providerComposer, resolveConfigValue } = await loadProviderComposer();
    expect(forcedCodex.config).toMatchObject({
      baseUrl: "http://codex.example/v1",
      apiKey: "$!literal$$TOKEN$${OTHER}$$$$tail",
      api: "openai-codex-responses",
    });
    expect(resolveConfigValue(forcedCodex.config.apiKey, {})).toBe(specialToken);
    expect(forcedCodex.config.streamSimple).toBeTypeOf("function");
    expect(forcedCodexModel).toMatchObject({
      api: "openai-codex-responses",
      baseUrl: "http://codex.example/v1",
      thinkingLevelMap: { off: "none", xhigh: "xhigh" },
    });
    expect(forcedCodexModel.compat).toBeUndefined();
    expect(resolveConfigValue(forcedCodexModel.headers!.Authorization, {})).toBe(
      `Bearer ${specialToken}`,
    );

    const anthropic = registrations[2]!;
    const anthropicModels = modelConfigs(anthropic);
    expect(anthropic.config).toMatchObject({
      baseUrl: "https://anthropic.example",
      api: "anthropic-messages",
    });
    expect(anthropic.config.streamSimple).toBeUndefined();
    expect(anthropicModels.map((model) => [model.api, model.baseUrl])).toEqual([
      ["anthropic-messages", "https://anthropic.example"],
      ["anthropic-messages", "https://anthropic.example"],
    ]);
    expect(anthropicModels[0]!.compat).toEqual({ forceAdaptiveThinking: true });
    expect(anthropicModels[1]!.compat).toBeUndefined();
    expect(anthropicModels[1]!.maxTokens).toBe(8192);

    const responses = registrations[3]!;
    const responsesModel = modelConfigs(responses)[0]!;
    expect(responses.config).toMatchObject({
      baseUrl: "https://responses.example/v1",
      api: "openai-responses",
    });
    expect(responses.config.streamSimple).toBeUndefined();
    expect(responsesModel).toMatchObject({
      api: "openai-responses",
      baseUrl: "https://responses.example/v1",
    });
    expect(responsesModel.compat).toBeUndefined();

    const completions = registrations[4]!;
    const completionsModel = modelConfigs(completions)[0]!;
    expect(completions.config).toMatchObject({
      baseUrl: "http://v1/v1",
      api: "openai-completions",
    });
    expect(completions.config.streamSimple).toBeUndefined();
    expect(completionsModel).toMatchObject({
      api: "openai-completions",
      baseUrl: "http://v1/v1",
    });
    expect(completionsModel.compat).toBeUndefined();

    const composedFallback = providerComposer.composeModelProvider(
      fallback.name,
      undefined,
      { getProvider: () => undefined },
      fallback.config,
    );
    expect(composedFallback.getModels().map((model: Record<string, any>) => model.api)).toEqual([
      "openai-codex-responses",
      "anthropic-messages",
      "openai-responses",
    ]);
    const resolvedFallbackAuth = await composedFallback.auth.apiKey.resolve({
      ctx: { env: async () => undefined },
    });
    expect(resolvedFallbackAuth.auth.apiKey).toBe("sk-fallback");
    expect(
      providerComposer.resolveConfiguredModelHeaders(
        composedFallback.getModels()[0],
        undefined,
        fallback.config,
        {},
      ),
    ).toEqual({ Authorization: "Bearer sk-fallback" });

    const composedForcedCodex = providerComposer.composeModelProvider(
      forcedCodex.name,
      undefined,
      { getProvider: () => undefined },
      forcedCodex.config,
    );
    const resolvedForcedAuth = await composedForcedCodex.auth.apiKey.resolve({
      ctx: { env: async () => undefined },
    });
    expect(resolvedForcedAuth.auth.apiKey).toBe(specialToken);
    expect(
      providerComposer.resolveConfiguredModelHeaders(
        composedForcedCodex.getModels()[0],
        undefined,
        forcedCodex.config,
        {},
      ),
    ).toEqual({ Authorization: `Bearer ${specialToken}` });

    for (const [index, registration] of [fallback, forcedCodex].entries()) {
      const configuredModel = modelConfigs(registration)[0]!;
      const model = { ...configuredModel, provider: registration.name };
      const streamOptions: Record<string, any> = { apiKey: registration.config.apiKey };
      if (index === 1) {
        streamOptions.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
          customFetchCalls.push({ url: String(input), init });
          return Response.json({ ok: true });
        };
      }
      const events = await collectStream(
        registration.config.streamSimple!(model as never, { messages: [] } as never, streamOptions),
      );
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }

    expect(codexCalls).toHaveLength(2);
    for (const call of codexCalls) {
      expect(call.options.apiKey.split(".")).toHaveLength(3);
      expect(decodeCodexAccountId(call.options.apiKey)).toBe(
        `sub2api-${Buffer.from(String(call.model.provider), "utf8").toString("base64url")}`,
      );
      expect(call.options.transport).toBe("sse");
    }

    expect(transportFetchCalls.map((call) => call.url)).toEqual([
      "https://fallback.example/v1/codex/responses",
    ]);
    expect(customFetchCalls.map((call) => call.url)).toEqual([
      "http://codex.example/v1/codex/responses",
    ]);
    expect(new Headers(transportFetchCalls[0]!.init?.headers).get("authorization")).toBe(
      "Bearer sk-fallback",
    );
    expect(new Headers(customFetchCalls[0]!.init?.headers).get("authorization")).toBe(
      `Bearer ${specialToken}`,
    );
    for (const [index, call] of [transportFetchCalls[0]!, customFetchCalls[0]!].entries()) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("chatgpt-account-id")).toBe(
        decodeCodexAccountId(codexCalls[index]!.options.apiKey),
      );
      expect(headers.get("openai-beta")).toBe("responses=experimental");
    }

    const generatedHeaders = {
      Authorization: `Bearer ${codexCalls[0]!.options.apiKey}`,
      "chatgpt-account-id": decodeCodexAccountId(codexCalls[0]!.options.apiKey),
    };
    await codexCalls[0]!.options.fetch("https://unrelated.example/v1/codex/responses", {
      headers: generatedHeaders,
    });
    let passthroughCall = transportFetchCalls.at(-1)!;
    expect(passthroughCall.url).toBe("https://unrelated.example/v1/codex/responses");
    expect(new Headers(passthroughCall.init?.headers).get("authorization")).toBe(
      `Bearer ${codexCalls[0]!.options.apiKey}`,
    );

    await codexCalls[0]!.options.fetch("https://fallback.example/v1/codex/responses", {
      headers: { ...generatedHeaders, "chatgpt-account-id": "wrong-account" },
    });
    passthroughCall = transportFetchCalls.at(-1)!;
    expect(new Headers(passthroughCall.init?.headers).get("authorization")).toBe(
      `Bearer ${codexCalls[0]!.options.apiKey}`,
    );

    const passthroughOptions = { apiKey: "real-chatgpt-token" };
    await collectStream(
      fallback.config.streamSimple!(
        {
          id: "codex",
          api: "openai-codex-responses",
          provider: "openai",
          baseUrl: "https://chatgpt.com/backend-api",
        } as never,
        { messages: [] } as never,
        passthroughOptions,
      ),
    );
    expect(codexCalls).toHaveLength(3);
    expect(codexCalls[2]!.options).toBe(passthroughOptions);

    const nativeFetchStart = transportFetchCalls.length;
    for (const [registration, apiKey] of [
      [anthropic, "sk-anthropic"],
      [responses, "sk-responses"],
      [completions, "sk-completions"],
    ] as const) {
      const composed = providerComposer.composeModelProvider(
        registration.name,
        undefined,
        { getProvider: () => undefined },
        registration.config,
      );
      const events = await collectStream(
        composed.streamSimple(composed.getModels()[0], { messages: [] } as never, {
          apiKey,
          fetch: globalThis.fetch,
        }),
      );
      expect(events.at(-1)).toMatchObject({ type: "error" });
    }
    expect(transportFetchCalls.slice(nativeFetchStart).map((call) => call.url)).toEqual([
      "https://anthropic.example/v1/messages",
      "https://responses.example/v1/responses",
      "http://v1/v1/chat/completions",
    ]);
  });

  it("rejects an unsupported configured API before registering providers", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        invalid: { baseURL: "https://invalid.example", token: "sk", api: "unknown" },
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to load"),
      expect.objectContaining({ message: expect.stringContaining("unsupported api") }),
    );
  });

  it.each(["?", "#"])("rejects a base URL with a trailing %s", async (suffix) => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ invalid: { baseURL: `https://invalid.example${suffix}`, token: "sk" } }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to load"),
      expect.objectContaining({
        message: expect.stringContaining("must not include a query or fragment"),
      }),
    );
  });
});
