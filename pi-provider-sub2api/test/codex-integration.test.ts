import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-codex-integration-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("real Codex adapter integration", () => {
  it.each(
    [
      { configured: undefined, expected: undefined },
      { configured: null, expected: undefined },
      { configured: "fast", expected: "priority" },
      { configured: "ultrafast", expected: "ultrafast" },
    ].flatMap((tier) =>
      [undefined, null, "gpt-5-mini"].map((compressModel) => ({ ...tier, compressModel })),
    ),
  )(
    "uses compress_service_tier=$configured and compress_model=$compressModel before session defaults",
    async ({ configured, expected, compressModel }) => {
      writeFileSync(
        join(stateDir, "sub2api.json"),
        JSON.stringify({
          codex: {
            baseURL: "https://codex-integration.example",
            token: "integration-relay-token",
            api: "openai-codex-responses",
            compress_service_tier: configured,
            compress_model: compressModel,
          },
        }),
      );
      const requests: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
        if (String(input).endsWith("/backend-api/codex/models")) {
          return Response.json({ models: [{ slug: "gpt-5.5" }] });
        }
        if (String(input).endsWith("/v1/responses")) {
          requests.push(JSON.parse(String(init?.body)));
          const response = {
            id: "cmp-tier-test",
            status: "completed",
            output: [{ type: "compaction", encrypted_content: "opaque-tier-test" }],
          };
          const events = [
            { type: "response.output_item.done", item: response.output[0] },
            { type: "response.completed", response },
          ];
          return new Response(
            events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          );
        }
        return new Response(null, { status: 404 });
      });
      type Handler = (event: any, ctx: any) => any;
      const handlers = new Map<string, Handler>();
      let toggleFast: Handler;
      let toggleUltrafast: Handler;
      let providerConfig: ProviderConfig;
      await extension({
        registerProvider(_name: string, config: ProviderConfig) {
          providerConfig = config;
        },
        registerCommand(name: string, options: { handler: Handler }) {
          if (name === "toggle-fast") toggleFast = options.handler;
          if (name === "toggle-ultrafast") toggleUltrafast = options.handler;
        },
        on(name: string, handler: Handler) {
          handlers.set(name, handler);
        },
        getAllTools: () => [],
        getActiveTools: () => [],
      } as unknown as ExtensionAPI);
      const user = {
        type: "message",
        id: "user-1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "Remember BLUE-42." }],
          timestamp: Date.now(),
        },
      };
      const ctx = {
        model: { ...providerConfig!.models![0], provider: "codex" },
        modelRegistry: { find: () => undefined },
        hasUI: true,
        getSystemPrompt: () => "You are Codex.",
        ui: { notify: vi.fn<(message: string, level: string) => void>() },
        sessionManager: { getBranch: () => [user] },
      };
      for (const sessionTier of [undefined, "priority", "ultrafast", undefined]) {
        if (sessionTier === "priority") await toggleFast!("", ctx);
        else if (requests.length) await toggleUltrafast!("", ctx);
        const result = await handlers.get("session_before_compact")!(
          {
            branchEntries: [user],
            preparation: { firstKeptEntryId: user.id, tokensBefore: 100 },
            signal: new AbortController().signal,
          },
          ctx,
        );
        expect(result?.compaction).toBeDefined();
        expect(requests.at(-1)?.model).toBe(compressModel ?? ctx.model.id);
        expect(result.compaction.details.model).toBe(ctx.model.id);
        const tier = expected ?? sessionTier;
        expect(requests.at(-1)?.service_tier).toBe(tier);
        expect(Object.hasOwn(requests.at(-1)!, "service_tier")).toBe(tier !== undefined);
        // The compaction override must never leak into ordinary conversation requests.
        const ordinary = handlers.get("before_provider_request")!(
          { payload: { model: ctx.model.id } },
          ctx,
        );
        expect(ordinary?.service_tier).toBe(sessionTier);
      }
      expect(requests).toHaveLength(4);
      expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.anything(), "warning");
    },
  );

  it("rewrites ultra reasoning and Fast mode into the relayed request", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://codex-integration.example",
          token: "integration-relay-token",
          api: "openai-codex-responses",
          serverTools: { responses: [{ type: "web_search" }] },
        },
      }),
    );

    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://codex-integration.example/backend-api/codex/models") {
        return Response.json({
          models: [
            {
              slug: "gpt-5.6-sol",
              supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"],
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });
    let providerConfig: ProviderConfig | undefined;
    let toggleUltra: ((args: string, ctx: any) => unknown) | undefined;
    let toggleFast: ((args: string, ctx: any) => unknown) | undefined;
    let toggleUltrafast: ((args: string, ctx: any) => unknown) | undefined;
    let toggleDaybreak: ((args: string, ctx: any) => unknown) | undefined;
    type BeforeRequestHandler = (
      event: { payload: unknown },
      ctx: {
        model: Record<string, unknown>;
        sessionManager: { getBranch(): unknown[] };
      },
    ) => unknown | Promise<unknown>;
    const beforeProviderRequestHandlers: BeforeRequestHandler[] = [];
    const setThinkingLevel = vi.fn<() => void>();
    await extension({
      registerProvider(_name: string, config: ProviderConfig) {
        providerConfig = config;
      },
      on(name: string, handler: BeforeRequestHandler) {
        if (name === "before_provider_request") beforeProviderRequestHandlers.push(handler);
      },
      registerCommand(name: string, options: { handler: (args: string, ctx: any) => unknown }) {
        if (name === "toggle-ultra") toggleUltra = options.handler;
        if (name === "toggle-fast") toggleFast = options.handler;
        if (name === "toggle-ultrafast") toggleUltrafast = options.handler;
        if (name === "toggle-daybreak") toggleDaybreak = options.handler;
      },
      setThinkingLevel,
    } as unknown as ExtensionAPI);

    expect(providerConfig?.streamSimple).toBeTypeOf("function");
    const modelConfig = providerConfig?.models?.[0];
    expect(modelConfig).toBeDefined();

    let controller = new AbortController();
    const transportCalls: Array<{
      url: string;
      headers: Headers;
      redirect?: RequestRedirect;
      body?: unknown;
    }> = [];
    const transportFetch: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const headers = new Headers(init?.headers ?? request?.headers);
      const bodyText =
        headers.get("content-encoding") === "zstd" && init?.body instanceof Uint8Array
          ? zstdDecompressSync(init.body).toString()
          : init?.body
            ? await new Response(init.body).text()
            : request
              ? await request.clone().text()
              : "";
      transportCalls.push({
        url: request?.url ?? String(input),
        headers,
        redirect: init?.redirect,
        body: bodyText ? JSON.parse(bodyText) : undefined,
      });
      controller.abort();
      return Response.json(
        { error: { type: "invalid_request_error", message: "intentional test stop" } },
        { status: 400 },
      );
    };

    const events = [];
    const model = { ...modelConfig, provider: "codex" };
    const applyProviderRequestHooks = async (
      payload: unknown,
      activeModel: Record<string, unknown>,
    ) => {
      let currentPayload = payload;
      for (const handler of beforeProviderRequestHandlers) {
        const nextPayload = await handler(
          { payload: currentPayload },
          { model: activeModel, sessionManager: { getBranch: () => [] } },
        );
        if (nextPayload !== undefined) currentPayload = nextPayload;
      }
      return currentPayload;
    };
    const stream = providerConfig!.streamSimple!(model as never, { messages: [] } as never, {
      fetch: transportFetch,
      signal: controller.signal,
      reasoning: "max",
      onPayload: (payload) => applyProviderRequestHooks(payload, model),
    });
    for await (const event of stream) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0]!.url).toBe("https://codex-integration.example/v1/responses");
    expect(transportCalls[0]!.headers.get("authorization")).toBe("Bearer integration-relay-token");
    expect(transportCalls[0]!.headers.get("chatgpt-account-id")).toBeNull();
    expect(transportCalls[0]!.redirect).toBe("error");
    expect(transportCalls[0]!.body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "max" },
    });
    expect(transportCalls[0]!.body).toMatchObject({
      tools: expect.arrayContaining([{ type: "web_search" }]),
    });
    expect(transportCalls[0]!.body).not.toHaveProperty("service_tier");
    expect(transportCalls[0]!.body).not.toHaveProperty("access_programs");

    expect(toggleUltra).toBeTypeOf("function");
    expect(toggleFast).toBeTypeOf("function");
    const commandContext = { ui: { notify() {} }, model: { reasoning: true } };
    await toggleUltra!("", commandContext);
    await toggleFast!("", commandContext);
    expect(setThinkingLevel).toHaveBeenCalledWith("max");

    controller = new AbortController();
    const ultraModelConfig = providerConfig?.models?.[0];
    expect(ultraModelConfig?.thinkingLevelMap).toMatchObject({ max: "ultra" });
    const ultraModel = { ...ultraModelConfig, provider: "codex" };
    const ultraStream = providerConfig!.streamSimple!(
      ultraModel as never,
      { messages: [] } as never,
      {
        fetch: transportFetch,
        signal: controller.signal,
        reasoning: "max",
        onPayload: (payload) => applyProviderRequestHooks(payload, ultraModel),
      },
    );
    for await (const event of ultraStream) events.push(event);

    expect(transportCalls).toHaveLength(2);
    expect(transportCalls[1]!.body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "ultra" },
      service_tier: "priority",
    });
    expect(transportCalls[1]!.body).toMatchObject({
      tools: expect.arrayContaining([{ type: "web_search" }]),
    });

    for (const enabled of [true, false]) {
      await toggleUltrafast!("", commandContext);
      await toggleDaybreak!("", commandContext);
      controller = new AbortController();
      const modeStream = providerConfig!.streamSimple!(
        ultraModel as never,
        { messages: [] } as never,
        {
          fetch: transportFetch,
          signal: controller.signal,
          reasoning: "max",
          onPayload: (payload) => applyProviderRequestHooks(payload, ultraModel),
        },
      );
      for await (const event of modeStream) events.push(event);
      const body = transportCalls.at(-1)!.body;
      expect(body).toMatchObject({
        access_programs: { cyber: enabled ? "daybreak_blue" : "standard" },
        reasoning: { effort: "ultra" },
        tools: expect.arrayContaining([{ type: "web_search" }]),
      });
      expect((body as Record<string, unknown>).service_tier).toBe(
        enabled ? "ultrafast" : undefined,
      );
    }
  });
});
