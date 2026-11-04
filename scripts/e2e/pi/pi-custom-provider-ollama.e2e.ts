// The package's own Ollama client from the outside: what reaches the daemon, and
// how the session ends when the daemon misbehaves.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import type { LocalServer, RecordedRequest } from "./servers.ts";
import { bodyOf, json } from "./servers.ts";
import {
  OLLAMA_DONE,
  isOllamaChat,
  ndjson,
  ollamaHandler,
  ollamaText,
  ollamaThinking,
} from "./servers-custom-provider.ts";
import { scenario } from "./scenario.ts";
import type { World } from "./world.ts";

const ONLINE = { packages: ["pi-custom-provider"], offline: false };
const PROVIDER = "ollama";
const ANSWER = "visible answer";
const THOUGHT = "PRIVATE-THINKING-MARKER";

function configure(world: World, server: LocalServer): void {
  world.writeAgentFile("custom-provider.json", {
    modelsDev: false,
    providers: { [PROVIDER]: { baseURL: server.baseUrl, api: "ollama", apiKey: "ollama" } },
  });
}

const selecting = (model: string): readonly string[] => [
  "--no-session",
  "--provider",
  PROVIDER,
  "--model",
  model,
  "--approve",
];

function assistantOf(request: RecordedRequest | undefined, index: number): JsonRecord {
  assert.ok(request !== undefined);
  const { messages } = bodyOf(request);
  assert.ok(Array.isArray(messages));
  const assistant: unknown = messages
    .filter((message: unknown) => isRecord(message) && message["role"] === "assistant")
    .at(index);
  assert.ok(isRecord(assistant), request.body);
  return assistant;
}

scenario(
  "thinking from one Ollama model does not reach the next model's request",
  ONLINE,
  async ({ world, server, rpc }) => {
    const ollama = await server(
      ollamaHandler(["first", "second"], () =>
        ndjson([ollamaThinking(THOUGHT), ollamaText(ANSWER), OLLAMA_DONE]),
      ),
    );
    configure(world, ollama);
    const client = rpc(selecting("first"));
    await client.prompt("one");
    await client.prompt("two");
    const switched = await client.send({
      type: "set_model",
      provider: PROVIDER,
      modelId: "second",
    });
    assert.equal(switched["success"], true, JSON.stringify(switched));
    await client.prompt("three");
    const chats = ollama.requests.filter(isOllamaChat);
    assert.equal(chats.length, 3);
    const sameModel = assistantOf(chats[1], 0);
    assert.equal(sameModel["thinking"], THOUGHT, "the same model replays its own thinking");
    assert.equal(sameModel["content"], ANSWER);
    const nextModel = chats[2];
    assert.ok(nextModel !== undefined);
    assert.equal(assistantOf(nextModel, 0)["content"], ANSWER, "the visible history survives");
    assert.ok(!nextModel.body.includes(THOUGHT), nextModel.body);
  },
);

const SYSTEM_MARKER = "SYSTEM-PROMPT-MARKER";
const AFFINITY_HEADER = "x-affinity";
const ANSWERED = ndjson([ollamaText(ANSWER), OLLAMA_DONE]);

/** A second extension that uses each provider hook Pi offers. */
const HOOKS_EXTENSION = `
export default function (pi) {
  pi.on("before_provider_request", (event) => ({
    ...event.payload,
    options: { ...event.payload.options, seed: 4242 },
  }));
  pi.on("before_provider_headers", (event) => {
    event.headers["x-second-extension"] = "yes";
  });
  pi.on("after_provider_response", (event, ctx) => {
    ctx.ui.notify("provider answered " + event.status, "info");
  });
}
`;

function toolNames(body: JsonRecord): readonly unknown[] {
  const { tools } = body;
  assert.ok(Array.isArray(tools), "the request must carry tools");
  return tools.map((tool: unknown) => {
    assert.ok(isRecord(tool) && isRecord(tool["function"]), JSON.stringify(tool));
    assert.ok(isRecord(tool["function"]["parameters"]), JSON.stringify(tool));
    return tool["function"]["name"];
  });
}

scenario(
  "an Ollama request carries the current tools, the system prompt, and the affinity header",
  ONLINE,
  async ({ world, server, rpc }) => {
    const ollama = await server(ollamaHandler(["local"], () => ANSWERED));
    world.writeAgentFile("custom-provider.json", {
      modelsDev: false,
      providers: {
        [PROVIDER]: {
          baseURL: ollama.baseUrl,
          api: "ollama",
          apiKey: "ollama",
          sessionAffinityHeader: AFFINITY_HEADER,
        },
      },
    });
    const client = rpc([
      ...selecting("local"),
      "--tools",
      "read",
      "--system-prompt",
      SYSTEM_MARKER,
    ]);
    await client.prompt("hello");
    const chat = ollama.requests.find(isOllamaChat);
    assert.ok(chat !== undefined);
    const body = bodyOf(chat);
    assert.deepEqual(toolNames(body), ["read"]);
    const { messages } = body;
    assert.ok(Array.isArray(messages));
    const first: unknown = messages[0];
    assert.ok(isRecord(first) && first["role"] === "system", chat.body);
    assert.ok(String(first["content"]).includes(SYSTEM_MARKER), chat.body);
    const state = await client.send({ type: "get_state" });
    assert.ok(isRecord(state["data"]));
    assert.equal(chat.headers[AFFINITY_HEADER], state["data"]["sessionId"]);
    assert.equal(chat.headers["authorization"], "Bearer ollama");
  },
);

scenario(
  "a second extension's provider hooks take effect on an Ollama request",
  ONLINE,
  async ({ world, server, rpc }) => {
    const ollama = await server(ollamaHandler(["local"], () => ANSWERED));
    configure(world, ollama);
    const hooks = world.writeAgentFile("fixtures/hooks.ts", HOOKS_EXTENSION);
    const client = rpc([...selecting("local"), "--extension", hooks]);
    await client.prompt("hello");
    const chat = ollama.requests.find(isOllamaChat);
    assert.ok(chat !== undefined);
    const { options } = bodyOf(chat);
    assert.ok(isRecord(options) && options["seed"] === 4242, chat.body);
    assert.ok(options["num_ctx"] !== undefined, "the rewrite builds on the adapter's payload");
    assert.equal(chat.headers["x-second-extension"], "yes");
    assert.ok(
      client.notifications().some((notice) => notice.message === "provider answered 200"),
      JSON.stringify(client.notifications()),
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

async function lastAssistant(client: RpcClient): Promise<JsonRecord> {
  const response = await client.send({ type: "get_messages" });
  const { data } = response;
  const messages: unknown = isRecord(data) ? data["messages"] : undefined;
  assert.ok(Array.isArray(messages));
  const last: unknown = messages.at(-1);
  assert.ok(isRecord(last) && last["role"] === "assistant", JSON.stringify(last));
  return last;
}

scenario(
  "HTTP 500 and 429 from Ollama end the turn with the daemon's error",
  ONLINE,
  async ({ world, server, rpc }) => {
    world.mergeSettings({ retry: { enabled: false } });
    let reply = json({ error: "model crashed" }, 500);
    const ollama = await server(ollamaHandler(["local"], () => reply));
    configure(world, ollama);
    const client = rpc(selecting("local"));
    await client.prompt("first");
    const crashed = await lastAssistant(client);
    assert.equal(crashed["stopReason"], "error");
    assert.equal(crashed["errorMessage"], "HTTP 500: model crashed");
    reply = json({ error: "slow down" }, 429);
    await client.prompt("second");
    const limited = await lastAssistant(client);
    assert.equal(limited["stopReason"], "error");
    assert.equal(limited["errorMessage"], "HTTP 429: slow down");
    assert.equal(ollama.requests.filter(isOllamaChat).length, 2);
  },
);

scenario(
  "a 429 from Ollama is retried when provider retries are configured",
  ONLINE,
  async ({ world, server, rpc }) => {
    world.mergeSettings({
      retry: { enabled: false, provider: { maxRetries: 2, maxRetryDelayMs: 10 } },
    });
    const limited = json({ error: "slow down" }, 429);
    let replies = 0;
    const ollama = await server(
      ollamaHandler(["local"], () => {
        replies += 1;
        return replies === 1 ? limited : ANSWERED;
      }),
    );
    configure(world, ollama);
    const client = rpc(selecting("local"));
    await client.prompt("hello");
    assert.equal(ollama.requests.filter(isOllamaChat).length, 2);
    const answer = await lastAssistant(client);
    assert.equal(answer["stopReason"], "stop", JSON.stringify(answer));
  },
);

scenario(
  "an Ollama stream that ends without done is an error, not an answer",
  ONLINE,
  async ({ world, server, rpc }) => {
    world.mergeSettings({ retry: { enabled: false } });
    const ollama = await server(ollamaHandler(["local"], () => ndjson([ollamaText("partial")])));
    configure(world, ollama);
    const client = rpc(selecting("local"));
    await client.prompt("hello");
    const answer = await lastAssistant(client);
    assert.equal(answer["stopReason"], "error");
    assert.equal(answer["errorMessage"], "Ollama stream ended without a done event");
  },
);

scenario(
  "aborting mid-stream ends the Ollama turn as aborted",
  ONLINE,
  async ({ world, server, rpc }) => {
    world.mergeSettings({ retry: { enabled: false } });
    const { promise: never } = Promise.withResolvers<void>();
    const ollama = await server(
      ollamaHandler(["local"], () =>
        ndjson([ollamaText("partial")], {
          holdOpen: async () => {
            await never;
          },
        }),
      ),
    );
    configure(world, ollama);
    const client = rpc(selecting("local"));
    const streaming = client.next((event) => event["type"] === "message_update", "stream text");
    const settled = client.next((event) => event["type"] === "agent_settled", "the abort");
    await client.send({ type: "prompt", message: "hello" });
    await streaming;
    await client.send({ type: "abort" });
    await settled;
    const answer = await lastAssistant(client);
    assert.equal(answer["stopReason"], "aborted", JSON.stringify(answer));
  },
);
