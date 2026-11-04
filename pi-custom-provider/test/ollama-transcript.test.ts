import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";

import type { Tool } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonResponse,
  notFound,
  startLocalServer,
  type LocalResponse,
  type LocalServer,
  type RecordedRequest,
} from "./local-server.ts";
import { loadExtensionHost } from "./pi-host.ts";

let agentDir: string;
let server: LocalServer | undefined;
let session: AgentSession | undefined;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-ollama-transcript-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("HOME", agentDir);
});

afterEach(async () => {
  session?.dispose();
  session = undefined;
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  await rm(agentDir, { recursive: true, force: true });
});

function ndjson(chunks: unknown[]): LocalResponse {
  return {
    headers: { "content-type": "application/x-ndjson" },
    body: `${chunks.map((chunk) => JSON.stringify(chunk)).join("\n")}\n`,
  };
}

const done = {
  message: { role: "assistant", content: "ok" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 1,
};

async function startOllama(handleChat: (request: RecordedRequest) => LocalResponse) {
  server = await startLocalServer((request) => {
    if (request.path === "/api/tags") return jsonResponse({ models: [{ model: "audit" }] });
    if (request.path === "/api/show") {
      return jsonResponse({
        capabilities: ["completion", "tools"],
        model_info: { "test.context_length": 32768 },
      });
    }
    if (request.path === "/api/chat") return handleChat(request);
    return notFound();
  });
  await writeFile(
    join(agentDir, "custom-provider.json"),
    JSON.stringify({
      modelsDev: false,
      providers: { ollama: { baseURL: server.url, api: "ollama", apiKey: "ollama" } },
    }),
  );
  const host = await loadExtensionHost(agentDir, agentDir);
  ({ session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    resourceLoader: host.loader,
    sessionManager: SessionManager.inMemory(agentDir),
    tools: ["read"],
  }));
  const registry = session.extensionRunner.getModelRegistry();
  const model = registry.find("ollama", "audit");
  if (!model) throw new Error("Ollama model was not registered");
  await session.setModel(model);
  return { session, registry, model, server };
}

function declaration(name: string): Tool {
  return { name, description: `Run ${name}`, parameters: { type: "object", properties: {} } };
}

describe("Ollama normalized transcripts", () => {
  it("advertises active tools and carries real tool results into the continuation", async () => {
    const file = join(agentDir, "message.txt");
    await writeFile(file, "ollama-tool-result-marker");
    let chatCalls = 0;
    const host = await startOllama(() => {
      chatCalls++;
      return chatCalls === 1
        ? ndjson([
            {
              ...done,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ function: { name: "read", arguments: { path: file } } }],
              },
            },
          ])
        : ndjson([done]);
    });
    await host.session.prompt("Read message.txt.");
    const requests = host.server.requests.filter(({ path }) => path === "/api/chat");
    expect(requests).toHaveLength(2);
    const first = JSON.parse(requests[0]!.body);
    expect(first.tools).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "read",
          parameters: expect.objectContaining({ type: "object" }),
        }),
      }),
    ]);
    const next = JSON.parse(requests[1]!.body);
    expect(next.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        tool_name: "read",
        content: expect.stringContaining("ollama-tool-result-marker"),
      }),
    );
    expect(host.session.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("applies system section replacements and deletions and the current tool set", async () => {
    const host = await startOllama(() => ndjson([done]));
    const result = await host.registry
      .streamSimple(host.model, {
        messages: [
          {
            role: "system",
            content: "Base instructions",
            sections: { active: "old section", removed: "deleted section" },
            toolsAdded: [declaration("old_tool")],
            timestamp: 0,
          },
          { role: "user", content: "first turn", timestamp: 1 },
          {
            role: "system",
            content: "Extra instructions",
            sections: { active: "current section", removed: null },
            toolsRemoved: [{ name: "old_tool" }],
            toolsAdded: [declaration("new_tool")],
            timestamp: 2,
          },
          { role: "user", content: "second turn", timestamp: 3 },
        ],
      })
      .result();
    expect(result.stopReason).toBe("stop");
    const request = host.server.requests.find(({ path }) => path === "/api/chat");
    if (!request) throw new Error("Missing Ollama chat request");
    const body = JSON.parse(request.body);
    expect(body.messages).toEqual([
      { role: "system", content: "Base instructions\n\nExtra instructions\n\ncurrent section" },
      { role: "user", content: "first turn" },
      { role: "user", content: "second turn" },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: declaration("new_tool") }]);
  });

  it("awaits raw stream observers before publishing their normalized events", async () => {
    const host = await startOllama(() =>
      ndjson([
        { message: { role: "assistant", content: "observed" }, done: false },
        { ...done, message: { role: "assistant", content: "" } },
      ]),
    );
    const order: string[] = [];
    let observed = 0;
    const stream = host.registry.streamSimple(
      host.model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      {
        onProviderStreamEvent: async () => {
          const index = ++observed;
          order.push(`observing-${index}`);
          await setImmediate();
          order.push(`observed-${index}`);
        },
      },
    );
    for await (const event of stream) {
      if (event.type === "text_delta") order.push("delta");
      if (event.type === "done") order.push("done");
    }
    expect(observed).toBe(2);
    expect(order.indexOf("observed-1")).toBeLessThan(order.indexOf("delta"));
    expect(order.indexOf("observed-1")).toBeLessThan(order.indexOf("observing-2"));
    expect(order.indexOf("observed-2")).toBeLessThan(order.indexOf("done"));
  });

  it("reports a failed raw observer as a stream error", async () => {
    const host = await startOllama(() => ndjson([done]));
    const result = await host.registry
      .streamSimple(
        host.model,
        { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
        {
          onProviderStreamEvent: async () => {
            throw new Error("observer rejected event");
          },
        },
      )
      .result();
    expect(result).toMatchObject({ stopReason: "error", errorMessage: "observer rejected event" });
  });
});
