import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("rewrites the Codex request to the Responses endpoint and injects the relay token", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        codex: {
          baseURL: "https://codex-integration.example",
          token: "integration-relay-token",
          api: "openai-codex-responses",
        },
      }),
    );

    vi.stubGlobal("fetch", async () => Response.json({ data: [{ id: "gpt-5.5" }] }));
    let providerConfig: ProviderConfig | undefined;
    await extension({
      registerProvider(_name: string, config: ProviderConfig) {
        providerConfig = config;
      },
      on() {},
      registerCommand() {},
    } as unknown as ExtensionAPI);

    expect(providerConfig?.streamSimple).toBeTypeOf("function");
    const modelConfig = providerConfig?.models?.[0];
    expect(modelConfig).toBeDefined();

    const controller = new AbortController();
    const transportCalls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
    const transportFetch: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      transportCalls.push({
        url: request?.url ?? String(input),
        headers: new Headers(init?.headers ?? request?.headers),
        redirect: init?.redirect,
      });
      controller.abort();
      return Response.json(
        { error: { type: "invalid_request_error", message: "intentional test stop" } },
        { status: 400 },
      );
    };

    const events = [];
    const stream = providerConfig!.streamSimple!(
      { ...modelConfig, provider: "codex" } as never,
      { messages: [] } as never,
      { fetch: transportFetch, signal: controller.signal },
    );
    for await (const event of stream) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0]!.url).toBe("https://codex-integration.example/v1/responses");
    expect(transportCalls[0]!.headers.get("authorization")).toBe("Bearer integration-relay-token");
    expect(transportCalls[0]!.headers.get("chatgpt-account-id")).toBeNull();
    expect(transportCalls[0]!.redirect).toBe("error");
  });
});
