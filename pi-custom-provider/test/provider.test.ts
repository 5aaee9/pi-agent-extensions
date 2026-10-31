import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDiscoveredModel } from "../index.ts";
import {
  jsonResponse,
  notFound,
  startLocalServer,
  unavailable,
  type LocalResponse,
  type LocalServer,
  type RecordedRequest,
} from "./local-server.ts";
import {
  loadExtensionHost,
  loadInPiProcess,
  recordNotifications,
  runExtensionCommand,
  startHostSession,
  type ExtensionHost,
} from "./pi-host.ts";

let agentDir: string;
let servers: LocalServer[];
let sessions: AgentSession[];

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-custom-provider-test-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  // Pi also reads user-scoped state under HOME; keep the developer's out of the plane.
  vi.stubEnv("HOME", agentDir);
  vi.stubEnv("CUSTOM_PROVIDER_KEY", "env-key");
  servers = [];
  sessions = [];
});

afterEach(async () => {
  for (const session of sessions) session.dispose();
  sessions = [];
  for (const server of servers) await server.close();
  servers = [];
  vi.unstubAllEnvs();
  await rm(agentDir, { recursive: true, force: true });
});

async function startServer(handle: (request: RecordedRequest) => LocalResponse) {
  const server = await startLocalServer(handle);
  servers.push(server);
  return server;
}

async function writeProviderConfig(config: unknown): Promise<void> {
  await writeFile(join(agentDir, "custom-provider.json"), JSON.stringify(config));
}

function loadHost(): Promise<ExtensionHost> {
  return loadExtensionHost(agentDir, agentDir);
}

async function startSession(host: ExtensionHost): Promise<AgentSession> {
  const session = await startHostSession(host, agentDir, agentDir);
  sessions.push(session);
  return session;
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

  it("reads Anthropic-style max_input_tokens and input modality arrays", () => {
    const model = parseDiscoveredModel(
      {
        id: "glm-5.3",
        display_name: "GLM-5.3",
        max_input_tokens: 1_000_000,
        max_tokens: 128_000,
        capabilities: null,
      },
      "anthropic-messages",
    );
    expect(model).toMatchObject({
      id: "glm-5.3",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      reasoning: false,
    });
    expect(
      parseDiscoveredModel({ id: "vision", input: ["text", "image"] }, "anthropic-messages"),
    ).toMatchObject({ input: ["text", "image"] });
  });
});

describe("custom provider extension", () => {
  it.each(["openai-completions", "anthropic-messages", "openai-responses", "ollama-chat"])(
    "uses command credentials for %s discovery while preserving runtime expressions",
    async (api) => {
      const server = await startServer((request) => {
        if (request.path.endsWith("/api/tags")) {
          return jsonResponse({ models: [{ model: "test-model" }] });
        }
        if (request.path.endsWith("/api/show"))
          return jsonResponse({ capabilities: ["completion"] });
        return jsonResponse({ data: [{ id: "test-model" }] });
      });
      const keyCommand = "!printf '%s\\n' 'command-key'";
      await writeProviderConfig({
        modelsDev: false,
        providers: {
          command: {
            baseURL: server.url,
            api,
            apiKey: keyCommand,
            headers: { "x-extra": "!printf extra-value" },
            cache: false,
          },
        },
      });
      const host = await loadHost();
      const provider = host.registrations[0]!.config;
      expect(provider.apiKey).toBe(keyCommand);
      expect(provider.headers?.["x-extra"]).toBe("!printf extra-value");
      expect(provider.models).toHaveLength(1);
      expect(server.requests.length).toBeGreaterThan(0);
      for (const request of server.requests) {
        const authHeader = api === "anthropic-messages" ? "x-api-key" : "authorization";
        expect(request.headers[authHeader]).toBe(
          api === "anthropic-messages" ? "command-key" : "Bearer command-key",
        );
        expect(request.headers["x-extra"]).toBe("extra-value");
      }
    },
  );

  it("does not make an unauthenticated discovery request when a command fails", async () => {
    const server = await startServer(() => jsonResponse({ data: [{ id: "unexpected" }] }));
    await writeProviderConfig({
      modelsDev: false,
      providers: {
        command: {
          baseURL: server.url,
          apiKey: "!printf secret >&2; exit 1",
          fallbackModels: [{ id: "fallback" }],
        },
      },
    });
    // The real pi binary loads the extension; its stderr carries the diagnostics.
    const piProcess = await loadInPiProcess(agentDir, {
      HOME: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
    });
    expect(piProcess.commands).toContain("refresh-custom-provider-models");
    expect(piProcess.stderr).toContain("[custom-provider:command] model discovery failed");
    expect(piProcess.stderr).not.toContain("secret");
    expect(server.requests).toHaveLength(0);

    const host = await loadHost();
    expect(server.requests).toHaveLength(0);
    expect(host.registrations[0]!.config.models![0]!.id).toBe("fallback");

    const session = await startSession(host);
    const notifications = recordNotifications(session);
    await runExtensionCommand(session, "refresh-custom-provider-models");

    expect(notifications).toEqual([{ message: "Custom provider models refreshed", type: "info" }]);
    expect(JSON.stringify(notifications)).not.toContain("secret");
    expect(server.requests).toHaveLength(0);
    expect(session.extensionRunner.getModelRegistry().find("command", "fallback")).toBeDefined();
  });

  it("registers all three APIs and reads models from their configured upstream endpoints", async () => {
    const server = await startServer((request) => {
      if (request.path === "/chat/v1/models") {
        return jsonResponse({
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
      if (request.path === "/anthropic/models") {
        return jsonResponse({
          models: [
            { id: "claude-compatible", thinking: { type: "adaptive", levels: ["low", "high"] } },
          ],
        });
      }
      if (request.path === "/responses/v1/models") {
        return jsonResponse({ data: [{ id: "plain-response" }] });
      }
      return notFound();
    });

    await writeProviderConfig({
      modelsDev: false,
      providers: {
        chat: {
          baseURL: `${server.url}/chat/v1`,
          apiKey: "$CUSTOM_PROVIDER_KEY",
          api: "openai-chat-compatible",
        },
        anthropic: {
          baseURL: `${server.url}/anthropic`,
          apiKey: "anthropic-key",
          api: "anthropic",
          modelsURL: `${server.url}/anthropic/models`,
        },
        responses: {
          baseURL: `${server.url}/responses/v1`,
          apiKey: "responses-key",
          api: "openai-responses",
        },
      },
    });

    const host = await loadHost();

    expect(host.registrations.map(({ name }) => name)).toEqual(["chat", "anthropic", "responses"]);
    expect(host.commands).toContain("refresh-custom-provider-models");
    expect(server.requests.map(({ path }) => path).sort()).toEqual(
      ["/chat/v1/models", "/anthropic/models", "/responses/v1/models"].sort(),
    );

    const chat = host.registrations[0]!;
    expect(chat.config).toMatchObject({
      baseUrl: `${server.url}/chat/v1`,
      api: "openai-completions",
      apiKey: "$CUSTOM_PROVIDER_KEY",
    });
    expect(chat.config.models![0]).toMatchObject({
      id: "chat-reasoning",
      reasoning: true,
      input: ["text", "image"],
      thinkingLevelMap: { off: null, minimal: "low", low: "low", high: "high", medium: null },
    });

    const anthropic = host.registrations[1]!;
    expect(anthropic.config).toMatchObject({
      baseUrl: `${server.url}/anthropic`,
      api: "anthropic-messages",
    });
    expect(anthropic.config.models![0]).toMatchObject({
      id: "claude-compatible",
      reasoning: true,
      baseUrl: `${server.url}/anthropic`,
    });
    expect(
      server.requests.find(({ path }) => path === "/anthropic/models")!.headers["x-api-key"],
    ).toBe("anthropic-key");
  });

  it("enriches models from models.dev and caches the catalog separately", async () => {
    let upstream: "ok" | "unavailable" = "ok";
    const server = await startServer((request) => {
      if (upstream === "unavailable") return unavailable();
      if (request.path === "/gateway/v1/models") {
        return jsonResponse({
          data: [{ id: "deepseek/deepseek-flash-max", context_window: 8192, cost: { input: 9 } }],
        });
      }
      if (request.path === "/metadata/api.json") {
        return jsonResponse({
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
      if (request.path === "/metadata/models.json") {
        return jsonResponse({
          "deepseek/deepseek-flash": { modalities: { input: ["text", "image"] } },
        });
      }
      return notFound();
    });

    await writeProviderConfig({
      modelsDev: {
        apiURL: `${server.url}/metadata/api.json`,
        modelsURL: `${server.url}/metadata/models.json`,
      },
      providers: {
        gateway: {
          baseURL: `${server.url}/gateway/v1`,
          api: "openai-responses",
          modelsDevProvider: "deepseek",
        },
      },
    });

    const first = await loadHost();
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

    // The server stays open but would now answer 503: a fresh on-disk cache must
    // answer on its own, so no request reaches the server at all.
    expect(server.requests).toHaveLength(3);
    upstream = "unavailable";
    const second = await loadHost();
    expect(second.registrations[0]!.config.models![0]!).toMatchObject({
      id: "deepseek/deepseek-flash-max",
      maxTokens: 4096,
      cost: { input: 9, output: 0.4 },
    });
    expect(server.requests).toHaveLength(3);
  });

  it("uses a fresh cache without a network request and falls back to the stale cache on an error status", async () => {
    let upstream: "ok" | "unavailable" = "ok";
    const server = await startServer(() =>
      upstream === "ok" ? jsonResponse({ data: [{ id: "cached-model" }] }) : unavailable(),
    );
    await writeProviderConfig({
      modelsDev: false,
      providers: {
        cached: {
          baseURL: `${server.url}/cached/v1`,
          apiKey: "key",
          api: "openai-responses",
          cache: { ttlSeconds: 3600 },
        },
      },
    });

    const first = await loadHost();
    expect(server.requests).toHaveLength(1);
    expect(first.registrations[0]!.config.models![0]!.id).toBe("cached-model");

    const cacheFile = join(agentDir, "custom-provider-models.json");
    const cache = JSON.parse(await readFile(cacheFile, "utf8"));
    expect(cache.providers.cached.models[0].id).toBe("cached-model");

    // A fresh cache answers without touching the network.
    const second = await loadHost();
    expect(second.registrations[0]!.config.models![0]!.id).toBe("cached-model");
    expect(server.requests).toHaveLength(1);

    // Expire the cache and let the real client see HTTP 503: discovery fails and
    // the stale cached models are used instead.
    cache.providers.cached.fetchedAt = Date.now() - 7_200_000;
    await writeFile(cacheFile, JSON.stringify(cache));
    upstream = "unavailable";
    const third = await loadHost();
    expect(third.registrations[0]!.config.models![0]!.id).toBe("cached-model");
    expect(server.requests.map(({ path }) => path)).toEqual([
      "/cached/v1/models",
      "/cached/v1/models",
    ]);
  });

  it("applies reasoningPattern, modelDefaults, and fallbackModels", async () => {
    const server = await startServer((request) => {
      if (request.path === "/gateway/v1/models") {
        return jsonResponse({
          data: [
            { id: "glm-5.3", max_input_tokens: 1_000_000, max_tokens: 128_000 },
            { id: "plain-model" },
          ],
        });
      }
      // The "offline" provider's endpoint rejects the request, so the real
      // client observes an error status and discovery falls back.
      return unavailable();
    });

    await writeProviderConfig({
      modelsDev: false,
      providers: {
        gateway: {
          baseURL: `${server.url}/gateway`,
          api: "anthropic",
          apiKey: "key",
          reasoningPattern: "glm-5",
          modelDefaults: {
            input: ["text", "image"],
            thinkingLevelMap: { xhigh: "max", max: "max" },
          },
        },
        offline: {
          baseURL: `${server.url}/offline`,
          api: "anthropic",
          fallbackModels: [
            {
              id: "fallback-model",
              display_name: "Fallback",
              max_input_tokens: 500_000,
              max_tokens: 32_000,
              reasoning: true,
              input: ["text", "image"],
            },
          ],
        },
      },
    });

    const host = await loadHost();

    const gateway = host.registrations.find((entry) => entry.name === "gateway")!;
    const glm = gateway.config.models!.find((model) => model.id === "glm-5.3")!;
    expect(glm).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { xhigh: "max", max: "max" },
    });
    const plain = gateway.config.models!.find((model) => model.id === "plain-model")!;
    expect(plain.reasoning).toBe(false);
    expect(plain.thinkingLevelMap).toBeUndefined();

    const offline = host.registrations.find((entry) => entry.name === "offline")!;
    expect(offline.config.models![0]).toMatchObject({
      id: "fallback-model",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 500_000,
      maxTokens: 32_000,
    });
    expect(server.requests.map(({ path }) => path).sort()).toEqual(
      ["/gateway/v1/models", "/offline/v1/models"].sort(),
    );
  });

  it("injects the configured session affinity header with the pi session id", async () => {
    const server = await startServer((request) =>
      request.path.endsWith("/models") ? jsonResponse({ data: [{ id: "m1" }] }) : notFound(),
    );
    await writeProviderConfig({
      modelsDev: false,
      providers: {
        zcode: {
          baseURL: `${server.url}/zcode`,
          api: "anthropic",
          apiKey: "key",
          sessionAffinityHeader: "x-session-id",
        },
        other: {
          baseURL: `${server.url}/other`,
          api: "openai-completions",
          apiKey: "key",
        },
      },
    });

    const host = await loadHost();
    expect(host.loaded.extensions[0]!.handlers.get("before_provider_headers")).toHaveLength(1);
    const session = await startSession(host);
    const registry = session.extensionRunner.getModelRegistry();

    const zcode = registry.find("zcode", "m1");
    if (!zcode) throw new Error("zcode/m1 was not registered by the extension");
    await session.setModel(zcode);
    const headers = await session.extensionRunner.emitBeforeProviderHeaders({});
    expect(headers["x-session-id"]).toBe(session.sessionManager.getSessionId());

    const other = registry.find("other", "m1");
    if (!other) throw new Error("other/m1 was not registered by the extension");
    await session.setModel(other);
    const otherHeaders = await session.extensionRunner.emitBeforeProviderHeaders({});
    expect(otherHeaders["x-session-id"]).toBeUndefined();
  });

  it("discovers Ollama models via /api/tags + /api/show and streams /api/chat", async () => {
    const server = await startServer((request) => {
      if (request.path === "/api/tags") {
        return jsonResponse({
          models: [{ model: "qwen3:8b", name: "qwen3:8b" }, { model: "llama3.2" }],
        });
      }
      if (request.path === "/api/show") {
        const body = JSON.parse(request.body) as { model?: string };
        if (body.model === "qwen3:8b") {
          return jsonResponse({
            capabilities: ["completion", "tools", "thinking"],
            model_info: { "qwen3.context_length": 40960 },
          });
        }
        return jsonResponse({
          capabilities: ["completion", "vision"],
          model_info: { "llama.context_length": 131072 },
        });
      }
      if (request.path === "/api/chat") {
        const chunks = [
          { model: "qwen3:8b", message: { role: "assistant", thinking: "thinking " }, done: false },
          { model: "qwen3:8b", message: { role: "assistant", thinking: "hard" }, done: false },
          { model: "qwen3:8b", message: { role: "assistant", content: "Hello" }, done: false },
          { model: "qwen3:8b", message: { role: "assistant", content: "!" }, done: false },
          {
            model: "qwen3:8b",
            message: { role: "assistant", content: "" },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 10,
            prompt_eval_cached_count: 4,
            eval_count: 2,
          },
        ];
        return {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
          body: `${chunks.map((chunk) => JSON.stringify(chunk)).join("\n")}\n`,
        };
      }
      return notFound();
    });

    await writeProviderConfig({
      modelsDev: false,
      providers: {
        ollama: {
          baseURL: server.url,
          // The README's local-deployment shape: Pi only offers providers that
          // carry a credential, so a placeholder key makes the model selectable.
          apiKey: "ollama",
          api: "ollama",
        },
      },
    });

    const host = await loadHost();
    const ollama = host.registrations[0]!;
    expect(ollama.config).toMatchObject({
      baseUrl: server.url,
      api: "ollama-chat",
    });
    expect(ollama.config.streamSimple).toBeTypeOf("function");

    const qwen = ollama.config.models!.find((model) => model.id === "qwen3:8b")!;
    expect(qwen).toMatchObject({
      reasoning: true,
      contextWindow: 40960,
      baseUrl: server.url,
    });
    const llama = ollama.config.models!.find((model) => model.id === "llama3.2")!;
    expect(llama).toMatchObject({
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 131072,
    });

    // Select the discovered model through Pi's own registry and session, and
    // let the session's real model stack drive the provider's stream.
    const session = await startSession(host);
    const registered = session.extensionRunner.getModelRegistry().find("ollama", "qwen3:8b");
    if (!registered) throw new Error("ollama/qwen3:8b was not registered by the extension");
    await session.setModel(registered);
    session.setThinkingLevel("medium");
    await session.prompt("hi");

    const chatCall = server.requests.find(({ path }) => path === "/api/chat");
    if (!chatCall) throw new Error("the session never called /api/chat");
    const chatBody = JSON.parse(chatCall.body) as {
      model: string;
      stream: boolean;
      think: unknown;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(chatBody).toMatchObject({ model: "qwen3:8b", stream: true, think: "medium" });
    expect(chatBody.messages[0]?.role).toBe("system");
    expect(chatBody.messages.at(-1)).toMatchObject({ role: "user", content: "hi" });
    expect(chatCall.headers.authorization).toBe("Bearer ollama");

    const reply = session.messages.at(-1);
    if (reply?.role !== "assistant")
      throw new Error("the session did not record an assistant reply");
    expect(reply.stopReason).toBe("stop");
    expect(reply.content).toEqual([
      { type: "thinking", thinking: "thinking hard" },
      { type: "text", text: "Hello!" },
    ]);
    expect(reply.usage).toMatchObject({
      input: 10,
      output: 2,
      cacheRead: 4,
      totalTokens: 16,
    });
  });

  it("registers refreshModels that rediscovers with the stored credential", async () => {
    let modelId = "model-v1";
    const server = await startServer(() => jsonResponse({ data: [{ id: modelId }] }));
    await writeProviderConfig({
      modelsDev: false,
      providers: {
        refreshable: {
          baseURL: `${server.url}/refresh`,
          api: "anthropic",
          apiKey: "config-key",
          authHeader: "authorization",
        },
      },
    });

    const host = await loadHost();
    const seenAuth = () => server.requests.map((request) => request.headers.authorization ?? null);
    expect(seenAuth()).toEqual(["Bearer config-key"]);

    const provider = host.registrations[0]!;
    // The key must stay on apiKey (with authHeader asking pi to send it as a
    // Bearer token): hiding it inside headers leaves the provider
    // "unconfigured", so pi filters its models out of the model list.
    expect(provider.config.apiKey).toBe("config-key");
    expect(provider.config.authHeader).toBe(true);
    expect(provider.config.headers?.Authorization).toBeUndefined();
    expect(provider.config.refreshModels).toBeTypeOf("function");

    // A credential stored in Pi's own auth file is what the host hands to
    // refreshModels; the registry's refresh entry point drives the call.
    await writeFile(
      join(agentDir, "auth.json"),
      JSON.stringify({ refreshable: { type: "api_key", key: "stored-key" } }),
    );
    const session = await startSession(host);
    const registry = session.extensionRunner.getModelRegistry();
    expect(registry.find("refreshable", "model-v1")).toBeDefined();

    modelId = "model-v2";
    const result = await registry.refresh({
      providers: ["refreshable"],
      allowNetwork: true,
      force: true,
    });
    expect(result.errors.size).toBe(0);
    expect(seenAuth()).toEqual(["Bearer config-key", "Bearer stored-key"]);
    expect(registry.find("refreshable", "model-v2")).toBeDefined();
  });
});
