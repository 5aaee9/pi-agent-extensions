const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { createJiti } = require("jiti");

function createTestStream() {
  const queue = [];
  const waiting = [];
  let done = false;

  return {
    push(event) {
      if (done) return;
      if (event.type === "done" || event.type === "error") done = true;
      const waiter = waiting.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    },
    end() {
      done = true;
      while (waiting.length > 0) waiting.shift()({ value: undefined, done: true });
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
        } else if (done) {
          return;
        } else {
          const result = await new Promise((resolvePromise) => waiting.push(resolvePromise));
          if (result.done) return;
          yield result.value;
        }
      }
    },
  };
}

async function collectStream(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  return events;
}

function createDoneEvent(model) {
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

(async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "sub2api-test-"));
  const compatPath = join(stateDir, "compat.cjs");
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalFetch = globalThis.fetch;
  const originalCompat = globalThis.__sub2apiTestCompat;

  const modelFetchCalls = [];
  const transportFetchCalls = [];
  const anthropicCalls = [];
  const codexCalls = [];
  const providerNames = new Set(["zero-aicoding", "中继-relay"]);
  const specialToken = "!literal$TOKEN${OTHER}$$tail";

  try {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        "zero-aicoding": {
          baseURL: "https://aicoding.example",
          token: "sk-zero",
        },
        "中继-relay": {
          baseURL: "http://relay-b.example/v1/",
          token: specialToken,
        },
        "claude-free": {
          baseURL: "https://claude.example",
          token: "sk-claude",
        },
      }),
    );

    writeFileSync(
      compatPath,
      `module.exports = {
        anthropicMessagesApi: () => globalThis.__sub2apiTestCompat.anthropicApi,
        createAssistantMessageEventStream: () => globalThis.__sub2apiTestCompat.createTestStream(),
        openAICodexResponsesApi: () => globalThis.__sub2apiTestCompat.codexApi,
      };\n`,
    );

    process.env.PI_CODING_AGENT_DIR = stateDir;

    globalThis.fetch = async (url, init) => {
      const value = String(url);
      if (value.endsWith("/models")) {
        modelFetchCalls.push({ url: value, init });
        const expectedToken = value.startsWith("https://aicoding.example")
          ? "sk-zero"
          : value.startsWith("http://relay-b.example")
            ? specialToken
            : "sk-claude";
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expectedToken}`);
        assert.ok(init?.signal instanceof AbortSignal);
        assert.equal(init.signal.aborted, false);
        return Response.json({
          data: value.startsWith("https://aicoding.example")
            ? [
                {
                  id: "gpt-5.5",
                  display_name: "GPT-5.5",
                  context_window: 250000,
                  max_tokens: 32000,
                },
                { id: "gpt-image-1", display_name: "GPT Image" },
              ]
            : value.startsWith("http://relay-b.example")
              ? [{ id: "codex-mini", display_name: "Codex Mini" }]
              : [
                  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
                  { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
                ],
        });
      }

      transportFetchCalls.push({ url: value, init });
      return Response.json({ ok: true });
    };

    const codexApi = {
      streamSimple(model, context, options) {
        codexCalls.push({ model, context, options });
        const stream = createTestStream();

        queueMicrotask(async () => {
          try {
            if (providerNames.has(model.provider)) {
              assert.equal(options.transport, "sse");
              assert.equal(typeof options.fetch, "function");
              const tokenPayload = JSON.parse(Buffer.from(options.apiKey.split(".")[1], "base64").toString("utf8"));
              const headers = {
                Authorization: `Bearer ${options.apiKey}`,
                "chatgpt-account-id": tokenPayload["https://api.openai.com/auth"].chatgpt_account_id,
                "OpenAI-Beta": "responses=v1",
              };
              await options.fetch(`${model.baseUrl}/codex/responses`, { headers });
            }
            stream.push(createDoneEvent(model));
          } catch (error) {
            stream.push({ type: "error", reason: "error", error });
          } finally {
            stream.end();
          }
        });

        return stream;
      },
    };

    const anthropicApi = {
      streamSimple(model, context, options) {
        anthropicCalls.push({ model, context, options });
        const stream = createTestStream();
        queueMicrotask(() => {
          stream.push(createDoneEvent(model));
          stream.end();
        });
        return stream;
      },
    };

    globalThis.__sub2apiTestCompat = { createTestStream, anthropicApi, codexApi };

    const jiti = createJiti(__filename, {
      alias: { "@earendil-works/pi-ai/compat": compatPath },
      fsCache: false,
      moduleCache: false,
      interopDefault: false,
    });
    const { default: extension } = jiti(resolve(__dirname, "..", "index.ts"));

    let searchDir = __dirname;
    let codingAgentDir;
    while (searchDir !== dirname(searchDir)) {
      const candidate = join(searchDir, "node_modules", "@earendil-works", "pi-coding-agent");
      if (existsSync(candidate)) {
        codingAgentDir = candidate;
        break;
      }
      searchDir = dirname(searchDir);
    }
    assert.ok(codingAgentDir, "@earendil-works/pi-coding-agent installation not found");
    const { resolveConfigValue } = await import(
      pathToFileURL(join(codingAgentDir, "dist", "core", "resolve-config-value.js")).href
    );
    const { composeModelProvider } = await import(
      pathToFileURL(join(codingAgentDir, "dist", "core", "provider-composer.js")).href
    );

    const registrations = [];
    await extension({
      registerProvider(name, config) {
        registrations.push({ name, config });
      },
    });

    assert.deepEqual(
      modelFetchCalls.map((call) => call.url),
      [
        "https://aicoding.example/v1/models",
        "http://relay-b.example/v1/models",
        "https://claude.example/v1/models",
      ],
    );
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      ["zero-aicoding", "中继-relay", "claude-free"],
    );

    const zero = registrations[0];
    assert.equal(zero.config.baseUrl, "https://aicoding.example/v1");
    assert.equal(zero.config.apiKey, "sk-zero");
    assert.equal(zero.config.api, "openai-codex-responses");
    assert.equal(typeof zero.config.streamSimple, "function");
    assert.deepEqual(
      zero.config.models.map((model) => model.id),
      ["gpt-5.5"],
    );
    assert.equal(zero.config.models[0].reasoning, true);
    assert.equal(zero.config.models[0].thinkingLevelMap.off, "none");
    assert.equal(zero.config.models[0].thinkingLevelMap.xhigh, "xhigh");
    assert.equal(zero.config.models[0].contextWindow, 250000);
    assert.equal(zero.config.models[0].maxTokens, 32000);

    const other = registrations[1];
    assert.equal(other.config.baseUrl, "http://relay-b.example/v1");
    assert.equal(other.config.apiKey, "$!literal$$TOKEN$${OTHER}$$$$tail");
    assert.equal(resolveConfigValue(other.config.apiKey, {}), specialToken);
    assert.deepEqual(
      other.config.models.map((model) => model.id),
      ["codex-mini"],
    );

    const claude = registrations[2];
    assert.equal(claude.config.baseUrl, "https://claude.example/v1");
    assert.equal(claude.config.apiKey, "sk-claude");
    assert.deepEqual(
      claude.config.models.map((model) => model.id),
      ["claude-opus-4-6", "claude-haiku-4-5-20251001"],
    );
    assert.equal(claude.config.models[0].api, "anthropic-messages");
    assert.equal(claude.config.models[0].baseUrl, "https://claude.example");
    assert.equal(claude.config.models[0].reasoning, true);
    assert.equal(claude.config.models[0].thinkingLevelMap.xhigh, "max");
    assert.equal(claude.config.models[0].compat.forceAdaptiveThinking, true);
    assert.equal(claude.config.models[1].maxTokens, 8192);
    assert.equal(claude.config.models[1].compat, undefined);

    const composedOther = composeModelProvider(
      other.name,
      undefined,
      { getProvider: () => undefined },
      other.config,
    );
    const resolvedOtherAuth = await composedOther.auth.apiKey.resolve({
      ctx: { env: async () => undefined },
    });
    assert.equal(resolvedOtherAuth.auth.apiKey, specialToken);

    const fetchBeforeStreams = globalThis.fetch;
    const customFetchCalls = [];
    for (const [index, registration] of registrations.slice(0, 2).entries()) {
      const model = {
        id: registration.config.models[0].id,
        api: "openai-codex-responses",
        provider: registration.name,
        baseUrl: registration.config.baseUrl,
      };
      const streamOptions = { apiKey: registration.config.apiKey };
      if (index === 1) {
        streamOptions.fetch = async (url, init) => {
          customFetchCalls.push({ url: String(url), init });
          return Response.json({ ok: true });
        };
      }
      const events = await collectStream(
        registration.config.streamSimple(model, { messages: [] }, streamOptions),
      );
      assert.equal(events.at(-1).type, "done");
    }

    assert.equal(codexCalls.length, 2);
    for (const call of codexCalls) {
      const tokenParts = call.options.apiKey.split(".");
      assert.equal(tokenParts.length, 3);
      assert.equal(
        JSON.parse(Buffer.from(tokenParts[1], "base64").toString("utf8"))["https://api.openai.com/auth"]
          .chatgpt_account_id,
        `sub2api-${Buffer.from(call.model.provider, "utf8").toString("base64url")}`,
      );
      assert.equal(call.options.transport, "sse");
    }

    assert.equal(globalThis.fetch, fetchBeforeStreams);
    assert.deepEqual(
      transportFetchCalls.map((call) => call.url),
      ["https://aicoding.example/v1/responses"],
    );
    assert.equal(
      new Headers(transportFetchCalls[0].init.headers).get("authorization"),
      "Bearer sk-zero",
    );
    assert.deepEqual(
      customFetchCalls.map((call) => call.url),
      ["http://relay-b.example/v1/responses"],
    );
    assert.equal(
      new Headers(customFetchCalls[0].init.headers).get("authorization"),
      `Bearer ${specialToken}`,
    );
    for (const call of [...transportFetchCalls, ...customFetchCalls]) {
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("chatgpt-account-id"), null);
      assert.equal(headers.get("openai-beta"), "responses=v1");
    }

    const generatedAccountId = JSON.parse(
      Buffer.from(codexCalls[0].options.apiKey.split(".")[1], "base64").toString("utf8"),
    )["https://api.openai.com/auth"].chatgpt_account_id;
    const generatedHeaders = {
      Authorization: `Bearer ${codexCalls[0].options.apiKey}`,
      "chatgpt-account-id": generatedAccountId,
    };
    await codexCalls[0].options.fetch("https://unrelated.example/v1/codex/responses", {
      headers: generatedHeaders,
    });
    const unrelatedCall = transportFetchCalls.at(-1);
    assert.equal(unrelatedCall.url, "https://unrelated.example/v1/codex/responses");
    assert.equal(
      new Headers(unrelatedCall.init.headers).get("authorization"),
      `Bearer ${codexCalls[0].options.apiKey}`,
    );

    const composedClaude = composeModelProvider(
      claude.name,
      undefined,
      { getProvider: () => undefined },
      claude.config,
    );
    const composedClaudeModel = composedClaude.getModels()[0];
    assert.equal(composedClaudeModel.api, "anthropic-messages");
    assert.equal(composedClaudeModel.baseUrl, "https://claude.example");
    const resolvedClaudeAuth = await composedClaude.auth.apiKey.resolve({
      ctx: { env: async () => undefined },
    });
    assert.equal(resolvedClaudeAuth.auth.apiKey, "sk-claude");

    const claudeModel = {
      ...claude.config.models[0],
      provider: claude.name,
      baseUrl: claude.config.baseUrl,
    };
    const claudeEvents = await collectStream(
      claude.config.streamSimple(claudeModel, { messages: [] }, { apiKey: claude.config.apiKey }),
    );
    assert.equal(claudeEvents.at(-1).type, "done");
    assert.equal(anthropicCalls.length, 1);
    assert.equal(anthropicCalls[0].model.api, "anthropic-messages");
    assert.equal(anthropicCalls[0].model.baseUrl, "https://claude.example");
    assert.equal(anthropicCalls[0].model.compat.forceAdaptiveThinking, true);
    assert.equal(anthropicCalls[0].options.apiKey, "sk-claude");
    assert.equal(transportFetchCalls.length, 2);
    assert.equal(customFetchCalls.length, 1);

    const passthroughOptions = { apiKey: "real-chatgpt-token" };
    await collectStream(
      zero.config.streamSimple(
        {
          id: "codex",
          api: "openai-codex-responses",
          provider: "openai",
          baseUrl: "https://chatgpt.com/backend-api",
        },
        { messages: [] },
        passthroughOptions,
      ),
    );
    assert.equal(codexCalls.length, 3);
    assert.equal(codexCalls[2].options, passthroughOptions);
  } finally {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    globalThis.fetch = originalFetch;
    if (originalCompat === undefined) delete globalThis.__sub2apiTestCompat;
    else globalThis.__sub2apiTestCompat = originalCompat;
    rmSync(stateDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
