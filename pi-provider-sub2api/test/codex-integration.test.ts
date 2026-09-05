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
  });
});
