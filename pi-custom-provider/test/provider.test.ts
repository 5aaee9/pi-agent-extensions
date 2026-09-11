import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { parseDiscoveredModel } from "../index.ts";

interface Registration {
  name: string;
  config: ProviderConfig;
}

let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-custom-provider-test-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("CUSTOM_PROVIDER_KEY", "env-key");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(agentDir, { recursive: true, force: true });
});

function registerProviders() {
  const registrations: Registration[] = [];
  const commands: string[] = [];
  const pi = {
    registerProvider(name: string, config: ProviderConfig) {
      registrations.push({ name, config });
    },
    registerCommand(name: string) {
      commands.push(name);
    },
    on() {},
  } as unknown as ExtensionAPI;
  return { registrations, commands, pi };
}

describe("upstream model metadata", () => {
  it("maps reasoning levels and capability fields without guessing from model names", () => {
    const model = parseDiscoveredModel(
      {
        id: "some-model",
        display_name: "Some Model",
        context_window: 131072,
        max_output_tokens: 8192,
        input_modalities: ["text", "image"],
        supported_reasoning_levels: ["low", "medium", "high"],
      },
      "openai-completions",
    );

    expect(model).toMatchObject({
      id: "some-model",
      name: "Some Model",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 131072,
      maxTokens: 8192,
      thinkingLevelMap: {
        off: null,
        minimal: "low",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
    });

    expect(
      parseDiscoveredModel(
        { id: "minimal-model", reasoning: true, supported_reasoning_levels: ["minimal"] },
        "openai-responses",
      ),
    ).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { minimal: "minimal", low: null, max: null },
    });
    expect(parseDiscoveredModel({ id: "gpt-unknown" }, "openai-responses")).toMatchObject({
      reasoning: false,
      thinkingLevelMap: undefined,
    });
  });
});

describe("custom provider extension", () => {
  it("registers all three APIs and reads models from their configured upstream endpoints", async () => {
    await writeFile(
      join(agentDir, "custom-provider.json"),
      JSON.stringify({
        modelsDev: false,
        providers: {
          chat: {
            baseURL: "https://chat.example/v1",
            apiKey: "$CUSTOM_PROVIDER_KEY",
            api: "openai-chat-compatible",
          },
          anthropic: {
            baseURL: "https://anthropic.example",
            apiKey: "anthropic-key",
            api: "anthropic",
            modelsURL: "https://anthropic.example/models",
          },
          responses: {
            baseURL: "https://responses.example/v1",
            apiKey: "responses-key",
            api: "openai-responses",
          },
        },
      }),
    );

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      if (url === "https://chat.example/v1/models") {
        return Response.json({
          data: [
            {
              id: "chat-reasoning",
              name: "Chat Reasoning",
              supported_reasoning_levels: ["low", "high"],
              input_modalities: ["text", "image"],
            },
          ],
        });
      }
      if (url === "https://anthropic.example/models") {
        return Response.json({
          models: [
            { id: "claude-compatible", thinking: { type: "adaptive", levels: ["low", "high"] } },
          ],
        });
      }
      if (url === "https://responses.example/v1/models") {
        return Response.json({ data: [{ id: "plain-response" }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const harness = registerProviders();
    await extension(harness.pi);

    expect(harness.registrations.map(({ name }) => name)).toEqual([
      "chat",
      "anthropic",
      "responses",
    ]);
    expect(harness.commands).toContain("refresh-custom-provider-models");
    expect(calls.map(({ url }) => url).sort()).toEqual(
      [
        "https://chat.example/v1/models",
        "https://anthropic.example/models",
        "https://responses.example/v1/models",
      ].sort(),
    );

    const chat = harness.registrations[0]!;
    expect(chat.config).toMatchObject({
      baseUrl: "https://chat.example/v1",
      api: "openai-completions",
      apiKey: "$CUSTOM_PROVIDER_KEY",
    });
    expect(chat.config.models![0]).toMatchObject({
      id: "chat-reasoning",
      reasoning: true,
      input: ["text", "image"],
      thinkingLevelMap: { off: null, minimal: "low", low: "low", high: "high", medium: null },
    });

    const anthropic = harness.registrations[1]!;
    expect(anthropic.config).toMatchObject({
      baseUrl: "https://anthropic.example",
      api: "anthropic-messages",
    });
    expect(anthropic.config.models![0]).toMatchObject({
      id: "claude-compatible",
      reasoning: true,
      baseUrl: "https://anthropic.example",
    });
    expect(
      new Headers(calls.find(({ url }) => url.includes("anthropic"))!.init?.headers).get(
        "x-api-key",
      ),
    ).toBe("anthropic-key");
  });

  it("enriches models from models.dev and caches the catalog separately", async () => {
    await writeFile(
      join(agentDir, "custom-provider.json"),
      JSON.stringify({
        modelsDev: {
          apiURL: "https://metadata.example/api.json",
          modelsURL: "https://metadata.example/models.json",
        },
        providers: {
          gateway: {
            baseURL: "https://gateway.example/v1",
            api: "openai-responses",
            modelsDevProvider: "deepseek",
          },
        },
      }),
    );

    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://gateway.example/v1/models") {
        return Response.json({
          data: [{ id: "deepseek/deepseek-flash-max", context_window: 8192, cost: { input: 9 } }],
        });
      }
      if (url === "https://metadata.example/api.json") {
        return Response.json({
          deepseek: {
            models: {
              "deepseek-flash": {
                reasoning: true,
                reasoning_options: [{ type: "effort", values: ["low", "high"] }],
                limit: { context: 64000, output: 4096 },
                cost: { input: 0.1, output: 0.4 },
              },
            },
          },
        });
      }
      if (url === "https://metadata.example/models.json") {
        return Response.json({
          "deepseek/deepseek-flash": { modalities: { input: ["text", "image"] } },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const first = registerProviders();
    await extension(first.pi);
    const model = first.registrations[0]!.config.models![0]!;
    expect(model).toMatchObject({
      id: "deepseek/deepseek-flash-max",
      contextWindow: 8192,
      maxTokens: 4096,
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 9, output: 0.4 },
    });

    const cache = JSON.parse(await readFile(join(agentDir, "custom-provider-models.json"), "utf8"));
    expect(cache.modelsDev.providers.deepseek.models["deepseek-flash"]).toBeDefined();

    let requestCount = 0;
    vi.stubGlobal("fetch", async () => {
      requestCount += 1;
      throw new Error("network unavailable");
    });
    const second = registerProviders();
    await extension(second.pi);
    expect(requestCount).toBe(0);
    expect(second.registrations[0]!.config.models![0]!.cost.output).toBe(0.4);
  });

  it("uses a fresh cache without a network request and falls back to stale cache", async () => {
    await writeFile(
      join(agentDir, "custom-provider.json"),
      JSON.stringify({
        modelsDev: false,
        providers: {
          cached: {
            baseURL: "https://cached.example/v1",
            apiKey: "key",
            api: "openai-responses",
            cache: { ttlSeconds: 3600 },
          },
        },
      }),
    );

    let requestCount = 0;
    vi.stubGlobal("fetch", async () => {
      requestCount += 1;
      return Response.json({ data: [{ id: "cached-model" }] });
    });
    const first = registerProviders();
    await extension(first.pi);
    expect(requestCount).toBe(1);
    expect(first.registrations[0]!.config.models![0]!.id).toBe("cached-model");

    const cache = JSON.parse(await readFile(join(agentDir, "custom-provider-models.json"), "utf8"));
    expect(cache.providers.cached.models[0].id).toBe("cached-model");

    vi.stubGlobal("fetch", async () => {
      throw new Error("network unavailable");
    });
    const second = registerProviders();
    await extension(second.pi);
    expect(second.registrations[0]!.config.models![0]!.id).toBe("cached-model");
  });
});
