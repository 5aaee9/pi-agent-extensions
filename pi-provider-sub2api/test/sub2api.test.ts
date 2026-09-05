import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

interface TestFooterComponent {
  render(width: number): string[];
  dispose?(): void;
}

interface TestFooterTheme {
  fg(color: string, text: string): string;
}

interface TestFooterData {
  getGitBranch(): string | null;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getAvailableProviderCount(): number;
  onBranchChange(callback: () => void): () => void;
}

type TestFooterFactory = (
  tui: { requestRender(): void },
  theme: TestFooterTheme,
  footerData: TestFooterData,
) => TestFooterComponent;

function createFooterHarness(statuses: ReadonlyMap<string, string> = new Map()) {
  let component: TestFooterComponent | undefined;
  const theme = { fg: (_color: string, text: string) => text };
  const footerData: TestFooterData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
  return {
    ui: {
      theme,
      setFooter(factory: TestFooterFactory | undefined) {
        component?.dispose?.();
        component = factory?.({ requestRender() {} }, theme, footerData);
      },
      notify() {},
    },
    render() {
      return (component?.render(200) ?? []).map((line) => line.trimEnd());
    },
  };
}

function createFooterContext(
  model: { provider: string; id: string },
  footer: ReturnType<typeof createFooterHarness>,
) {
  return {
    hasUI: true,
    mode: "tui",
    cwd: join(homedir(), "Projects", "demo"),
    model,
    thinkingLevel: "off",
    getContextUsage: () => ({ tokens: 0, contextWindow: 64_000, percent: 0 }),
    sessionManager: {
      getEntries: () => [],
      getSessionName: () => undefined,
    },
    ui: footer.ui,
  };
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
      {
        id: "grok-4-fast",
        name: "Grok 4 Fast",
        context_length: "131072",
        max_output_tokens: "24576",
      },
      { id: "gpt-image-1", display_name: "GPT Image" },
    ],
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
    models: [
      { id: "gpt-5.5-forced-responses", display_name: "Forced Responses" },
      {
        id: "grok-invalid-metadata",
        display_name: "Invalid Metadata",
        context_window: 0.5,
        max_tokens: 99_999_999,
      },
      { id: "grok-camel", contextWindow: "111000", maxTokens: "11000" },
      {
        id: "grok-max-aliases",
        max_context_tokens: 122000,
        max_completion_tokens: 12000,
      },
      { id: "grok-limit", limit: { context: "133000", output: "13000" } },
    ],
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
  vi.useRealTimers();
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
    on() {},
    registerCommand() {},
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

function createAssistantMessage(
  model: Record<string, any>,
  stopReason: "pending" | "stop" | "error" = "stop",
  errorMessage?: string,
): Record<string, any> {
  return {
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
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

function createStartEvent(model: Record<string, any>) {
  return { type: "start", partial: createAssistantMessage(model, "pending") };
}

function createDoneEvent(model: Record<string, any>) {
  return {
    type: "done",
    reason: "stop",
    message: createAssistantMessage(model),
  };
}

function createErrorEvent(model: Record<string, any>, errorMessage: string) {
  return {
    type: "error",
    reason: "error",
    error: createAssistantMessage(model, "error", errorMessage),
  };
}

async function* createTextAttemptEvents(
  model: Record<string, any>,
  text: string,
  includeDone = true,
) {
  const partial = createAssistantMessage(model, "pending");
  yield { type: "start", partial };
  partial.content.push({ type: "text", text: "" });
  yield { type: "text_start", contentIndex: 0, partial };
  partial.content[0]!.text = text;
  yield { type: "text_delta", contentIndex: 0, delta: text, partial };
  yield { type: "text_end", contentIndex: 0, content: text, partial };
  if (includeDone) {
    yield {
      type: "done",
      reason: "stop",
      message: { ...partial, stopReason: "stop" },
    };
  }
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
    const metadataFetchCalls: FetchCall[] = [];
    const billingFetchCalls: FetchCall[] = [];
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
      if (url.endsWith("/backend-api/codex/models")) {
        metadataFetchCalls.push({ url, init });
        return Response.json({
          models:
            url === "http://codex.example/backend-api/codex/models"
              ? [
                  {
                    slug: "claude-forced-codex",
                    display_name: "Forced Codex",
                    supported_reasoning_levels: ["low", "medium", "high", "xhigh"],
                  },
                ]
              : [],
        });
      }
      if (url.endsWith("/v1/sub2api/billing")) {
        billingFetchCalls.push({ url, init });
        return new Response(null, { status: 404 });
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
      expect(call.init?.redirect).toBe("error");
    }
    expect(
      metadataFetchCalls
        .map((call) => [call.url, new Headers(call.init?.headers).get("authorization")])
        .sort(),
    ).toEqual(
      [
        ["http://codex.example/backend-api/codex/models", `Bearer ${specialToken}`],
        ["https://fallback.example/backend-api/codex/models", "Bearer sk-fallback"],
        ["https://responses.example/backend-api/codex/models", "Bearer sk-responses"],
      ].sort(),
    );
    for (const call of metadataFetchCalls) {
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call.init?.redirect).toBe("error");
    }
    expect(billingFetchCalls).toHaveLength(Object.keys(relayDefinitions).length);
    for (const call of billingFetchCalls) {
      expect(new Headers(call.init?.headers).get("authorization")).toMatch(/^Bearer /);
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call.init?.redirect).toBe("error");
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
      thinkingLevelMap: { off: "none", minimal: "low", xhigh: "xhigh" },
      contextWindow: 250000,
      maxTokens: 32000,
    });
    expect(fallbackModels[1]!.compat).toEqual({ forceAdaptiveThinking: true });
    expect(fallbackModels[1]!.thinkingLevelMap).toEqual({ xhigh: "max" });
    expect(fallbackModels[2]).toMatchObject({
      name: "Grok 4 Fast",
      reasoning: false,
      contextWindow: 131072,
      maxTokens: 24576,
    });

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
      thinkingLevelMap: { off: "none", minimal: "low", xhigh: "xhigh" },
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
    const responsesModels = modelConfigs(responses);
    const responsesModel = responsesModels[0]!;
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
    expect(responsesModels.slice(1).map((model) => [model.contextWindow, model.maxTokens])).toEqual(
      [
        [200000, 16384],
        [111000, 11000],
        [122000, 12000],
        [133000, 13000],
      ],
    );

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

    // Codex requests are rewritten from /v1/codex/responses to /v1/responses.
    expect(transportFetchCalls.map((call) => call.url)).toEqual([
      "https://fallback.example/v1/responses",
    ]);
    expect(customFetchCalls.map((call) => call.url)).toEqual(["http://codex.example/v1/responses"]);
    expect(new Headers(transportFetchCalls[0]!.init?.headers).get("authorization")).toBe(
      "Bearer sk-fallback",
    );
    expect(new Headers(customFetchCalls[0]!.init?.headers).get("authorization")).toBe(
      `Bearer ${specialToken}`,
    );
    for (const call of [transportFetchCalls[0]!, customFetchCalls[0]!]) {
      const headers = new Headers(call.init?.headers);
      expect(call.init?.redirect).toBe("error");
      expect(headers.get("chatgpt-account-id")).toBeNull();
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

  it("merges protocol-specific server tools without replacing Pi tools", async () => {
    const responsesTools = [
      { type: "web_search" },
      { type: "web_search_preview", search_context_size: "low" },
      { type: "file_search", vector_store_ids: ["vs_docs"] },
      { type: "code_interpreter", container: { type: "auto" } },
      {
        type: "shell",
        environment: { type: "container_auto", memory_limit: "4g" },
      },
      {
        type: "mcp",
        server_label: "docs",
        server_url: "https://mcp.example/sse",
        require_approval: "never",
      },
      {
        type: "tool_search",
        execution: "server",
        description: "Load hosted tools only when needed",
      },
      { type: "future_responses_hosted_tool", option: { enabled: true } },
    ];
    const anthropicTools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 4,
      },
      {
        type: "web_fetch_20250910",
        name: "web_fetch",
        max_uses: 2,
      },
      {
        type: "code_execution_20260120",
        name: "code_execution",
      },
      {
        type: "tool_search_tool_regex_20251119",
        name: "tool_search_tool_regex",
      },
      {
        type: "tool_search_tool_bm25_20251119",
        name: "tool_search_tool_bm25",
      },
      { type: "future_anthropic_server_tool", name: "future_tool" },
    ];
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        "responses-tools": {
          baseURL: "https://responses-tools.example",
          token: "sk-responses-tools",
          api: "openai-responses",
          serverTools: { responses: responsesTools },
        },
        "anthropic-tools": {
          baseURL: "https://anthropic-tools.example",
          token: "sk-anthropic-tools",
          api: "anthropic-messages",
          serverTools: { anthropic: anthropicTools },
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://responses-tools.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.6" }] });
      }
      if (url === "https://anthropic-tools.example/v1/models") {
        return Response.json({ data: [{ id: "claude-opus-4-6" }] });
      }
      return new Response(null, { status: 404 });
    });

    type BeforeRequestHandler = (
      event: { payload: unknown },
      context: {
        model: Record<string, any>;
        sessionManager: { getBranch(): unknown[] };
      },
    ) => unknown | Promise<unknown>;
    const registrations: Registration[] = [];
    const beforeRequestHandlers: BeforeRequestHandler[] = [];
    await extension({
      registerProvider(name: string, config: ProviderConfig) {
        registrations.push({ name, config });
      },
      on(name: string, handler: BeforeRequestHandler) {
        if (name === "before_provider_request") beforeRequestHandlers.push(handler);
      },
      registerCommand() {},
    } as unknown as ExtensionAPI);

    expect(beforeRequestHandlers).toHaveLength(3);
    const applyRequestHooks = async (payload: unknown, model: Record<string, any>) => {
      let currentPayload = payload;
      for (const handler of beforeRequestHandlers) {
        const nextPayload = await handler(
          { payload: currentPayload },
          { model, sessionManager: { getBranch: () => [] } },
        );
        if (nextPayload !== undefined) currentPayload = nextPayload;
      }
      return currentPayload;
    };

    const responsesRegistration = registrations.find(
      (registration) => registration.name === "responses-tools",
    )!;
    const responsesModel = {
      ...modelConfigs(responsesRegistration)[0]!,
      provider: responsesRegistration.name,
    };
    const piFunction = {
      type: "function",
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    };
    const responsesPayload = {
      model: responsesModel.id,
      tools: [piFunction, { type: "web_search" }],
      stream: true,
    };
    expect(await applyRequestHooks(responsesPayload, responsesModel)).toEqual({
      ...responsesPayload,
      tools: [piFunction, ...responsesTools],
    });
    expect(responsesPayload.tools).toEqual([piFunction, { type: "web_search" }]);

    const anthropicRegistration = registrations.find(
      (registration) => registration.name === "anthropic-tools",
    )!;
    const anthropicModel = {
      ...modelConfigs(anthropicRegistration)[0]!,
      provider: anthropicRegistration.name,
    };
    const anthropicPayload = {
      model: anthropicModel.id,
      tools: [
        {
          name: "read",
          description: "Read a file",
          input_schema: { type: "object", properties: {} },
        },
      ],
    };
    expect(await applyRequestHooks(anthropicPayload, anthropicModel)).toEqual({
      ...anthropicPayload,
      tools: [...anthropicPayload.tools, ...anthropicTools],
    });
    expect(anthropicPayload.tools).toHaveLength(1);

    expect(
      await applyRequestHooks(
        { model: responsesModel.id, tools: [] },
        { ...responsesModel, provider: "other-provider" },
      ),
    ).toEqual({ model: responsesModel.id, tools: [] });
    expect(
      await applyRequestHooks(
        { model: responsesModel.id, tools: [] },
        { ...responsesModel, api: "openai-completions" },
      ),
    ).toEqual({ model: responsesModel.id, tools: [] });
  });

  it("publishes the Codex stream start before generation finishes", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://timing.example",
          token: "sk-timing",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://timing.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    let resolveSourceStarted!: () => void;
    const sourceStarted = new Promise<void>((resolveStarted) => {
      resolveSourceStarted = resolveStarted;
    });
    let resolveFinishGeneration!: () => void;
    const finishGeneration = new Promise<void>((resolveGeneration) => {
      resolveFinishGeneration = resolveGeneration;
    });
    codexApiMock.streamSimple.mockImplementation(() =>
      (async function* () {
        yield createStartEvent(model);
        resolveSourceStarted();
        await finishGeneration;
        const done = createDoneEvent(model);
        done.message.usage.output = 336;
        done.message.usage.totalTokens = 336;
        yield done;
      })(),
    );

    let clockMs = 0;
    const observed: { type: string; at: number; output: number }[] = [];
    const stream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      {},
    );
    const collecting = (async () => {
      for await (const event of stream) {
        const message =
          (event as any).type === "done" ? (event as any).message : (event as any).partial;
        observed.push({
          type: (event as any).type,
          at: clockMs,
          output: message.usage.output,
        });
      }
    })();

    await sourceStarted;
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    expect(observed).toEqual([{ type: "start", at: 0, output: 0 }]);

    clockMs = 1_000;
    resolveFinishGeneration();
    await collecting;
    expect(observed).toEqual([
      { type: "start", at: 0, output: 0 },
      { type: "done", at: 1_000, output: 336 },
    ]);
    expect(observed[1]!.output / ((observed[1]!.at - observed[0]!.at) / 1_000)).toBe(336);
  });

  it("retries Codex stream_read_error forever with exponential backoff capped at 30 minutes", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://retry.example",
          token: "sk-retry",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://retry.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    const callTimes: number[] = [];
    codexApiMock.streamSimple.mockImplementation(() => {
      callTimes.push(Date.now());
      const attempt = callTimes.length;
      return (async function* () {
        if (attempt <= 13) {
          if (attempt === 1) {
            for await (const event of createTextAttemptEvents(model, "stale partial", false)) {
              yield event;
            }
          } else yield createStartEvent(model);
          yield createErrorEvent(model, "Codex error: stream_read_error");
          return;
        }
        for await (const event of createTextAttemptEvents(model, "fresh response")) yield event;
      })();
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const retryingStream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      { signal: controller.signal },
    );
    const streamPromise = collectStream(retryingStream);
    await vi.advanceTimersByTimeAsync(0);
    expect(callTimes).toEqual([0]);

    const expectedDelays = [
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 512_000, 1_024_000,
      1_800_000, 1_800_000,
    ];
    for (const [index, delay] of expectedDelays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(callTimes).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(callTimes).toHaveLength(index + 2);
    }

    const events = await streamPromise;
    expect(
      events
        .filter((event: any) => event.type === "start" || event.type === "done")
        .map((event: any) => event.type),
    ).toEqual(["start", "done"]);
    expect(JSON.stringify(events)).not.toContain("stale partial");
    expect(JSON.stringify(events)).toContain("fresh response");
    await expect(retryingStream.result()).resolves.toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "fresh response" }],
    });
    expect(callTimes.slice(1).map((time, index) => time - callTimes[index]!)).toEqual(
      expectedDelays,
    );
    expect(warning).toHaveBeenCalledTimes(expectedDelays.length);
    expect(addAbortListener).toHaveBeenCalled();
    expect(removeAbortListener).toHaveBeenCalledTimes(addAbortListener.mock.calls.length);
  });

  it("keeps the outer stream active during stalled Codex attempts and retry backoffs", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://retry.example",
          token: "sk-retry",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://retry.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    let attempt = 0;
    codexApiMock.streamSimple.mockImplementation(() => {
      attempt += 1;
      if (attempt > 8) return createTextAttemptEvents(model, "fresh response");
      const stallBeforeError = attempt === 1;
      return (async function* () {
        yield createStartEvent(model);
        if (stallBeforeError) await new Promise((resolve) => setTimeout(resolve, 95_000));
        yield createErrorEvent(model, "Upstream request failed");
      })();
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const observedAt: number[] = [];
    const retryingStream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      {},
    );
    const collecting = (async () => {
      for await (const _event of retryingStream) observedAt.push(Date.now());
    })();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(95_000);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await collecting;

    expect(
      Math.max(...observedAt.slice(1).map((time, index) => time - observedAt[index]!)),
    ).toBeLessThanOrEqual(30_000);
    await expect(retryingStream.result()).resolves.toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "fresh response" }],
    });
  });

  it("retries Upstream request failed errors", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://retry.example",
          token: "sk-retry",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://retry.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    codexApiMock.streamSimple
      .mockImplementationOnce(() =>
        (async function* () {
          yield createStartEvent(model);
          yield createErrorEvent(model, "Upstream request failed");
        })(),
      )
      .mockImplementationOnce(() => createTextAttemptEvents(model, "fresh response"));

    const retryingStream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      {},
    );
    const streamPromise = collectStream(retryingStream);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(
      (await streamPromise)
        .filter((event: any) => event.type === "start" || event.type === "done")
        .map((event: any) => event.type),
    ).toEqual(["start", "done"]);
    await expect(retryingStream.result()).resolves.toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "fresh response" }],
    });
    expect(codexApiMock.streamSimple).toHaveBeenCalledTimes(2);
  });

  it("returns Codex context overflow errors to Pi without retrying", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://retry.example",
          token: "sk-retry",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://retry.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    const overflowMessage =
      "Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.";
    codexApiMock.streamSimple.mockImplementationOnce(() =>
      (async function* () {
        yield createStartEvent(model);
        yield createErrorEvent(model, overflowMessage);
      })(),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();

    const overflowStream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      {},
    );
    const streamPromise = collectStream(overflowStream);
    await vi.advanceTimersByTimeAsync(1_000);
    const events = await streamPromise;

    expect(events.at(-1)).toMatchObject({
      type: "error",
      reason: "error",
      error: { errorMessage: overflowMessage },
    });
    expect(codexApiMock.streamSimple).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();

    codexApiMock.streamSimple.mockImplementationOnce(() =>
      (async function* () {
        yield* [];
        throw new Error(overflowMessage);
      })(),
    );
    const thrownEvents = await collectStream(
      registration!.config.streamSimple!(model as never, { messages: [] } as never, {}),
    );
    expect(thrownEvents.at(-1)).toMatchObject({
      type: "error",
      reason: "error",
      error: { errorMessage: overflowMessage },
    });
    expect(codexApiMock.streamSimple).toHaveBeenCalledTimes(2);
    expect(warning).not.toHaveBeenCalled();
  });

  it("stops Codex stream retries on abort and retries thrown errors", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://retry.example",
          token: "sk-retry",
          api: "openai-codex-responses",
        },
      }),
    );
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://retry.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.5", context_window: 200_000, max_tokens: 16_384 }],
        });
      }
      return new Response(null, { status: 404 });
    });

    const [registration] = await registerProviders();
    const model = { ...modelConfigs(registration!)[0]!, provider: registration!.name };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();

    const controller = new AbortController();
    codexApiMock.streamSimple.mockImplementationOnce(() =>
      (async function* () {
        for await (const event of createTextAttemptEvents(model, "stale partial", false)) {
          yield event;
        }
        yield createErrorEvent(model, "Codex error: stream_read_error");
      })(),
    );
    const abortedStream = registration!.config.streamSimple!(
      model as never,
      { messages: [] } as never,
      { signal: controller.signal },
    );
    const abortedPromise = collectStream(abortedStream);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    const abortedEvents = await abortedPromise;
    expect(abortedEvents.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
    expect(JSON.stringify(abortedEvents)).not.toContain("stale partial");
    await expect(abortedStream.result()).resolves.toMatchObject({
      stopReason: "aborted",
      content: [],
    });
    expect(codexApiMock.streamSimple).toHaveBeenCalledTimes(1);

    codexApiMock.streamSimple
      .mockImplementationOnce(() =>
        (async function* () {
          for await (const event of createTextAttemptEvents(model, "old attempt", false)) {
            yield event;
          }
          throw new Error("socket exploded");
        })(),
      )
      .mockImplementationOnce(() => createTextAttemptEvents(model, "fresh response"));
    const thrownPromise = collectStream(
      registration!.config.streamSimple!(model as never, { messages: [] } as never, {}),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const thrownEvents = await thrownPromise;
    expect(
      thrownEvents
        .filter((event: any) => event.type === "start" || event.type === "done")
        .map((event: any) => event.type),
    ).toEqual(["start", "done"]);
    expect(JSON.stringify(thrownEvents)).not.toContain("old attempt");
    expect(JSON.stringify(thrownEvents)).toContain("fresh response");
    expect(codexApiMock.streamSimple).toHaveBeenCalledTimes(3);
  });

  it("refreshes a dedicated final footer row and shows active mode badges", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        "quota-relay": { baseURL: "https://quota.example", token: "sk-quota" },
      }),
    );

    let quotaVersion = 0;
    const fetchCalls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      fetchCalls.push({ url, init });
      if (url === "https://quota.example/v1/models") {
        return Response.json({
          data: [{ id: "grok-quota", limits: { context: 64000, output: 8000 } }],
        });
      }
      if (url === "https://quota.example/usage") {
        return new Response("<!doctype html><p>not an API</p>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://quota.example/v1/usage") {
        quotaVersion += 1;
        return Response.json({
          rateLimits: [
            {
              limit: "20",
              remaining: String(20 - quotaVersion * 2),
              used: String(quotaVersion * 2),
              window: "5h",
              resetAt: "2030-01-01T00:00:00Z",
            },
            { limit: 100, remaining: 90, used: 10, window: "1d" },
          ],
          dailyUsage: [
            {
              date: "2026-08-05",
              requests: "7",
              inputTokens: "1000",
              outputTokens: 500,
              cacheReadTokens: 250,
              cacheWriteTokens: 50,
              totalTokens: "1800",
              cost: "0.5",
              actualCost: "0.4",
            },
            { date: "2026-08-04", requests: 1, totalTokens: 25, cost: 99, actualCost: 0 },
          ],
          usage: {
            today: { actualCost: String(quotaVersion / 10) },
          },
          status: "valid",
          mode: "subscription",
        });
      }
      return new Response(null, { status: 404 });
    });

    const registrations: Registration[] = [];
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const registerCommand =
      vi.fn<
        (name: string, options: { handler: (args: string, context: any) => unknown }) => void
      >();
    const setThinkingLevel = vi.fn<() => void>();
    await extension({
      registerProvider(name: string, config: ProviderConfig) {
        registrations.push({ name, config });
      },
      on(name: string, handler: (event: any, context: any) => unknown) {
        handlers.set(name, handler);
      },
      registerCommand,
      setThinkingLevel,
    } as unknown as ExtensionAPI);

    expect(registrations).toHaveLength(1);
    expect(modelConfigs(registrations[0]!)[0]).toMatchObject({
      contextWindow: 64000,
      maxTokens: 8000,
    });
    expect([...handlers.keys()]).toEqual([
      "session_before_compact",
      "before_provider_request",
      "session_start",
      "model_select",
      "turn_end",
      "session_shutdown",
    ]);
    expect(registerCommand).toHaveBeenCalledWith(
      "toggle-ultra",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(registerCommand).toHaveBeenCalledWith(
      "toggle-fast",
      expect.objectContaining({ handler: expect.any(Function) }),
    );

    const footer = createFooterHarness(new Map([["mcp", "mcp connected"]]));
    const activeModel = { provider: "quota-relay", id: "grok-quota" };
    const context = createFooterContext(activeModel, footer);

    handlers.get("session_start")!({}, context);
    expect(footer.render()[0]).toBe("~/Projects/demo (main)");
    expect(footer.render().slice(-2)).toEqual(["mcp connected", "quota-relay · loading…"]);
    await vi.waitFor(() => expect(footer.render().at(-1)).toBe("quota-relay · 5h 10% · d 10%"));
    expect(quotaVersion).toBe(1);

    handlers.get("model_select")!({ model: activeModel }, context);
    await vi.waitFor(() => expect(footer.render().at(-1)).toContain("5h 20%"));
    expect(quotaVersion).toBe(2);

    handlers.get("turn_end")!({}, context);
    await vi.waitFor(() => expect(footer.render().at(-1)).toContain("5h 30%"));
    expect(quotaVersion).toBe(3);

    const toggleUltra = registerCommand.mock.calls.find(([name]) => name === "toggle-ultra")?.[1]
      .handler;
    const toggleFast = registerCommand.mock.calls.find(([name]) => name === "toggle-fast")?.[1]
      .handler;
    const beforeProviderRequest = handlers.get("before_provider_request")!;
    const fastModel = {
      provider: "quota-relay",
      id: "gpt-5.6",
      api: "openai-codex-responses",
    };
    const fastContext = { ...context, model: fastModel };
    const requestPayload = { model: fastModel.id, stream: true, service_tier: "default" };

    expect(toggleUltra).toBeTypeOf("function");
    expect(toggleFast).toBeTypeOf("function");
    expect(beforeProviderRequest({ payload: requestPayload }, fastContext)).toBeUndefined();

    await toggleFast!("", context);
    expect(footer.render().at(-1)).toBe("quota-relay · 5h 30% · d 10% [FAST]");
    expect(beforeProviderRequest({ payload: requestPayload }, fastContext)).toEqual({
      ...requestPayload,
      service_tier: "priority",
    });
    expect(requestPayload.service_tier).toBe("default");
    expect(
      beforeProviderRequest(
        { payload: { model: "claude-opus-4-6" } },
        {
          ...fastContext,
          model: {
            provider: "quota-relay",
            id: "claude-opus-4-6",
            api: "anthropic-messages",
          },
        },
      ),
    ).toBeUndefined();
    expect(
      beforeProviderRequest(
        { payload: { model: fastModel.id } },
        { ...fastContext, model: { ...fastModel, provider: "other" } },
      ),
    ).toBeUndefined();

    await toggleUltra!("", context);
    expect(setThinkingLevel).toHaveBeenCalledWith("max");
    expect(footer.render().at(-1)).toBe("quota-relay · 5h 30% · d 10% [ULTRA ENABLED] [FAST]");
    await toggleFast!("", context);
    expect(footer.render().at(-1)).toBe("quota-relay · 5h 30% · d 10% [ULTRA ENABLED]");
    await toggleUltra!("", context);
    expect(footer.render().at(-1)).toBe("quota-relay · 5h 30% · d 10%");

    const usageCalls = fetchCalls.filter((call) => call.url.endsWith("/usage"));
    expect(usageCalls.map((call) => call.url)).toEqual([
      "https://quota.example/usage",
      "https://quota.example/v1/usage",
      "https://quota.example/v1/usage",
      "https://quota.example/v1/usage",
    ]);
    for (const call of usageCalls) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer sk-quota");
      expect(call.init?.redirect).toBe("error");
    }

    const callsBeforeNoUiTurn = fetchCalls.length;
    handlers.get("turn_end")!({}, { ...context, hasUI: false });
    expect(fetchCalls).toHaveLength(callsBeforeNoUiTurn);

    context.model = { provider: "other", id: "other-model" };
    handlers.get("model_select")!({ model: context.model }, context);
    expect(footer.render().at(-1)).toBe("mcp connected");
  });

  it("keeps an unavailable usage status visible when the relay has no usage endpoint", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ unavailable: { baseURL: "https://unavailable.example", token: "sk" } }),
    );

    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://unavailable.example/v1/models") {
        return Response.json({ data: [{ id: "grok-unavailable" }] });
      }
      return new Response(null, { status: 404 });
    });

    const handlers = new Map<string, (event: any, context: any) => unknown>();
    await extension({
      registerProvider() {},
      registerCommand() {},
      on(name: string, handler: (event: any, context: any) => unknown) {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);

    const footer = createFooterHarness();
    const context = createFooterContext(
      { provider: "unavailable", id: "grok-unavailable" },
      footer,
    );

    handlers.get("session_start")!({}, context);
    expect(footer.render().at(-1)).toBe("unavailable · loading…");
    await vi.waitFor(() => expect(footer.render().at(-1)).toBe("unavailable · usage unavailable"));
  });

  it("allows the usage endpoint enough time to return slow aggregate data", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ slow: { baseURL: "https://slow.example", token: "sk-slow" } }),
    );

    let activeTimeout = 0;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      activeTimeout = delay;
      return new AbortController().signal;
    });
    const usageTimeouts: number[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://slow.example/v1/models") {
        return Response.json({ data: [{ id: "grok-slow" }] });
      }
      if (url === "https://slow.example/v1/sub2api/billing") {
        return new Response(null, { status: 404 });
      }
      if (url === "https://slow.example/usage") {
        usageTimeouts.push(activeTimeout);
        return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      }
      if (url === "https://slow.example/v1/usage") {
        usageTimeouts.push(activeTimeout);
        if (activeTimeout < 30_000) return new Response(null, { status: 400 });
        return Response.json({
          usage: { today: { actual_cost: 448.47, total_tokens: 655_300_000 } },
        });
      }
      return new Response(null, { status: 404 });
    });

    const handlers = new Map<string, (event: any, context: any) => unknown>();
    await extension({
      registerProvider() {},
      registerCommand() {},
      on(name: string, handler: (event: any, context: any) => unknown) {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);

    const footer = createFooterHarness();
    const context = createFooterContext({ provider: "slow", id: "grok-slow" }, footer);

    handlers.get("session_start")!({}, context);
    await vi.waitFor(() => expect(footer.render().at(-1)).toBe("slow · d $448.47 · 655.3m tok"));
    expect(usageTimeouts).toEqual([30_000, 30_000]);
  });

  it("applies Sub2API billing rates and shows subscription usage in the UI", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        "subscription-relay": { baseURL: "https://subscription.example", token: "sk-sub" },
      }),
    );

    const fetchCalls: FetchCall[] = [];
    let billingMultiplier = 0.75;
    let billingAvailable = true;
    let usageAvailable = true;
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      fetchCalls.push({ url, init });
      if (url === "https://subscription.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.5", display_name: "GPT-5.5" }] });
      }
      if (url === "https://subscription.example/backend-api/codex/models") {
        return Response.json({ models: [] });
      }
      if (url === "https://subscription.example/v1/sub2api/billing") {
        if (!billingAvailable) return new Response(null, { status: 404 });
        return Response.json({
          object: "sub2api.key_billing",
          schema_version: 1,
          billing_scope: "token",
          group_rate_multiplier: 1,
          resolved_rate_multiplier: billingMultiplier,
          peak_rate_enabled: false,
          effective_rate_multiplier: billingMultiplier,
          observed_at: "2026-08-06T00:00:00Z",
        });
      }
      if (url === "https://subscription.example/usage") {
        return new Response("<!doctype html><p>not an API</p>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://subscription.example/v1/usage") {
        if (!usageAvailable) return new Response(null, { status: 400 });
        return Response.json({
          mode: "unrestricted",
          isValid: true,
          planName: "Weekly plan",
          remaining: -1,
          unit: "USD",
          subscription: {
            daily_usage_usd: 3,
            weekly_usage_usd: 6,
            monthly_usage_usd: 9,
            daily_limit_usd: 10,
            weekly_limit_usd: 20,
            monthly_limit_usd: 30,
            weekly_window_start: "2026-08-03T00:00:00Z",
            expires_at: "2026-09-01T00:00:00Z",
          },
          usage: {
            today: {
              requests: 7,
              input_tokens: 1000,
              output_tokens: 500,
              cache_read_tokens: 250,
              cache_creation_tokens: 50,
              total_tokens: 1800,
              cost: 0.5,
              actual_cost: 0.4,
            },
            total: { actual_cost: 4.2 },
          },
          daily_usage: [
            {
              date: "2026-08-06",
              requests: 7,
              input_tokens: 1000,
              output_tokens: 500,
              cache_read_tokens: 250,
              cache_write_tokens: 50,
              total_tokens: 1800,
              cost: 0.5,
              actual_cost: 0.4,
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });

    const registrations: Registration[] = [];
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    await extension({
      registerProvider(name: string, config: ProviderConfig) {
        registrations.push({ name, config });
      },
      registerCommand() {},
      on(name: string, handler: (event: any, context: any) => unknown) {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);

    expect.soft(modelConfigs(registrations[0]!)[0]!.cost).toEqual({
      input: 3.75,
      output: 22.5,
      cacheRead: 0.375,
      cacheWrite: 0,
      tiers: [
        {
          inputTokensAbove: 272000,
          input: 7.5,
          output: 33.75,
          cacheRead: 0.75,
          cacheWrite: 0,
        },
      ],
    });

    const footer = createFooterHarness();
    const context = createFooterContext({ provider: "subscription-relay", id: "gpt-5.5" }, footer);

    handlers.get("session_start")!({}, context);
    expect(footer.render().at(-1)).toBe("subscription-relay · loading…");
    await vi.waitFor(() =>
      expect(footer.render().at(-1)).toBe("subscription-relay · d 30% · w 30% · m 30%"),
    );

    billingMultiplier = 0.5;
    handlers.get("model_select")!({ model: context.model }, context);
    await vi.waitFor(() => expect(registrations).toHaveLength(2));
    expect.soft(modelConfigs(registrations.at(-1)!)[0]!.cost.input).toBe(2.5);
    expect.soft(footer.render().at(-1)).toBe("subscription-relay · d 30% · w 30% · m 30%");

    usageAvailable = false;
    billingMultiplier = 0.25;
    handlers.get("model_select")!({ model: context.model }, context);
    await vi.waitFor(() => expect(registrations).toHaveLength(3));
    expect.soft(modelConfigs(registrations.at(-1)!)[0]!.cost.input).toBe(1.25);
    expect.soft(footer.render().at(-1)).toBe("subscription-relay · d 30% · w 30% · m 30%");

    billingAvailable = false;
    handlers.get("turn_end")!({}, context);
    await vi.waitFor(() => expect(registrations).toHaveLength(4));
    expect.soft(modelConfigs(registrations.at(-1)!)[0]!.cost.input).toBe(5);
    expect.soft(footer.render().at(-1)).not.toContain("×");

    const billingCall = fetchCalls.find(
      (call) => call.url === "https://subscription.example/v1/sub2api/billing",
    );
    expect.soft(billingCall).toBeDefined();
    expect.soft(new Headers(billingCall?.init?.headers).get("authorization")).toBe("Bearer sk-sub");
    expect.soft(billingCall?.init?.redirect).toBe("error");
    expect.soft(billingCall?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not publish an in-flight quota result after session shutdown", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ stale: { baseURL: "https://stale.example", token: "sk-stale" } }),
    );

    let resolveUsage: ((response: Response) => void) | undefined;
    let usageSignal: AbortSignal | undefined;
    let markUsageStarted: (() => void) | undefined;
    const usageStarted = new Promise<void>((resolveStarted) => {
      markUsageStarted = resolveStarted;
    });
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "grok-stale" }] });
      if (url === "https://stale.example/usage") return new Response(null, { status: 404 });
      if (url === "https://stale.example/v1/usage") {
        usageSignal = init?.signal ?? undefined;
        markUsageStarted?.();
        return new Promise<Response>((resolveResponse) => {
          resolveUsage = resolveResponse;
        });
      }
      return new Response(null, { status: 404 });
    });

    const handlers = new Map<string, (event: any, context: any) => unknown>();
    await extension({
      registerProvider() {},
      on(name: string, handler: (event: any, context: any) => unknown) {
        handlers.set(name, handler);
      },
      registerCommand() {},
    } as unknown as ExtensionAPI);

    const footer = createFooterHarness();
    const context = createFooterContext({ provider: "stale", id: "grok-stale" }, footer);
    handlers.get("session_start")!({}, context);
    await usageStarted;
    expect(footer.render().at(-1)).toBe("stale · loading…");
    handlers.get("session_shutdown")!({}, context);
    expect(usageSignal?.aborted).toBe(true);
    resolveUsage?.(
      Response.json({
        rate_limits: [{ limit: 10, used: 1, remaining: 9, window: "5h" }],
      }),
    );
    await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));

    expect(footer.render()).not.toContain("stale · loading…");
  });

  it("retries model discovery with exponential backoff and a five-second timeout", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ retry: { baseURL: "https://retry.example", token: "sk-retry" } }),
    );
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    const retryDelays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      retryDelays.push(delay ?? 0);
      return realSetTimeout(callback, 0);
    }) as typeof setTimeout);
    let attempts = 0;
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/v1/sub2api/billing")) {
        return new Response(null, { status: 404 });
      }
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("terminated"));
            },
          }),
        );
      }
      if (attempts === 2) return new Response(null, { status: 503 });
      return Response.json({ data: [{ id: "grok-retry" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const registrations = await registerProviders();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(timeoutSpy.mock.calls).toEqual([[5_000], [5_000], [5_000], [5_000]]);
    expect(retryDelays).toEqual([1_000, 2_000]);
    expect(registrations).toHaveLength(1);
  });

  it("bounds remote JSON responses to one MiB", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ bounded: { baseURL: "https://bounded.example", token: "sk-bounded" } }),
    );
    vi.stubGlobal("fetch", async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            controller.close();
          },
        }),
      );
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(1);
    expect(modelConfigs(registrations[0]!)).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to fetch models"),
      expect.objectContaining({ message: expect.stringContaining("response exceeds") }),
    );
  });

  it.each([
    {
      label: "non-object container",
      entry: { serverTools: true },
      message: "serverTools must be an object",
    },
    {
      label: "unknown protocol group",
      entry: { serverTools: { chat: [] } },
      message: "unsupported serverTools group",
    },
    {
      label: "non-array protocol list",
      entry: { serverTools: { responses: { type: "web_search" } } },
      message: "serverTools.responses must be an array",
    },
    {
      label: "missing tool type",
      entry: { serverTools: { responses: [{}] } },
      message: "must have a valid non-empty type",
    },
    {
      label: "client-executed Responses function",
      entry: { serverTools: { responses: [{ type: "function", name: "local" }] } },
      message: "requires client-side handling",
    },
    {
      label: "unrepresentable Responses image output",
      entry: { serverTools: { responses: [{ type: "image_generation" }] } },
      message: "output Pi cannot retain",
    },
    {
      label: "file search without vector stores",
      entry: { serverTools: { responses: [{ type: "file_search", vector_store_ids: [] }] } },
      message: "requires non-empty vector_store_ids",
    },
    {
      label: "code interpreter without a hosted container",
      entry: { serverTools: { responses: [{ type: "code_interpreter" }] } },
      message: "requires a container ID",
    },
    {
      label: "shell with a local environment",
      entry: {
        serverTools: { responses: [{ type: "shell", environment: { type: "local" } }] },
      },
      message: "requires a hosted container environment",
    },
    {
      label: "client-executed tool search",
      entry: {
        serverTools: { responses: [{ type: "tool_search", execution: "client" }] },
      },
      message: 'requires execution "server"',
    },
    {
      label: "interactive MCP approval",
      entry: {
        serverTools: {
          responses: [
            {
              type: "mcp",
              server_label: "docs",
              server_url: "https://mcp.example/sse",
              authorization: "mcp-secret",
              require_approval: "always",
            },
          ],
        },
      },
      message: 'requires require_approval "never"',
    },
    {
      label: "client-executed Anthropic bash",
      entry: {
        api: "anthropic-messages",
        serverTools: { anthropic: [{ type: "bash_20250124", name: "bash" }] },
      },
      message: "requires client-side handling",
    },
    {
      label: "invalid Anthropic built-in name",
      entry: {
        api: "anthropic-messages",
        serverTools: {
          anthropic: [{ type: "web_search_20250305", name: "wrong_name" }],
        },
      },
      message: "requires name web_search",
    },
    {
      label: "protocol mismatch",
      entry: {
        api: "anthropic-messages",
        serverTools: { responses: [{ type: "web_search" }] },
      },
      message: "cannot use serverTools.responses",
    },
    {
      label: "Completions protocol",
      entry: {
        api: "openai-completions",
        serverTools: { responses: [{ type: "web_search" }] },
      },
      message: "cannot use serverTools with api openai-completions",
    },
  ])("rejects $label server tool configuration", async ({ entry, message }) => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        invalid: {
          baseURL: "https://invalid-tools.example",
          token: "config-secret",
          ...entry,
        },
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(0);
    const error = consoleError.mock.calls[0]?.[1];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    expect((error as Error).message).not.toContain("config-secret");
    expect((error as Error).message).not.toContain("mcp-secret");
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

  it.each([
    {
      label: "base URL",
      entry: { baseURL: "https://example.com\n", token: "sk" },
      message: "baseURL must not include control characters",
    },
    {
      label: "token",
      entry: { baseURL: "https://example.com", token: "sk\nsecret" },
      message: "token must not include control characters",
    },
  ])("rejects control characters in the $label", async ({ entry, message }) => {
    writeFileSync(join(stateDir, "sub2api.json"), JSON.stringify({ invalid: entry }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(0);
    const error = consoleError.mock.calls[0]?.[1];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    expect((error as Error).message).not.toContain("\n");
  });

  it("rejects credentials embedded in a base URL", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ invalid: { baseURL: "https://user:pass@example.com", token: "sk" } }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const registrations = await registerProviders();

    expect(registrations).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to load"),
      expect.objectContaining({ message: expect.stringContaining("must not include credentials") }),
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
