// Moonshot's validator rejects a whole request over one untyped enum, and a relay can route any
// model there, so every relay request carries the type and no other provider's request changes.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import { PACKAGE, modelArgs } from "./pi-provider-sub2api-support.ts";
import { PROBE_MODEL, PROBE_PROVIDER } from "./world.ts";

const TOOL = "status_tool";
const UNTYPED = { enum: ["pending", "done"] };
const TYPED = { type: "string", enum: ["pending", "done"] };

const UNTYPED_ENUM_TOOL = `
export default function (pi) {
  pi.registerTool({
    name: "${TOOL}",
    label: "${TOOL}",
    description: "Reports a status",
    parameters: {
      type: "object",
      properties: { status: ${JSON.stringify(UNTYPED)} },
    },
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  });
}
`;

function statusSchema(request: RecordedRequest | undefined): unknown {
  assert.ok(request !== undefined, "a request reached the server");
  const { tools } = bodyOf(request);
  assert.ok(Array.isArray(tools), "the request lists tools");
  const entries: readonly unknown[] = tools;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const wrapped = entry["function"];
    const tool: JsonRecord = isRecord(wrapped) ? wrapped : entry;
    if (tool["name"] !== TOOL) continue;
    const schema = tool["parameters"] ?? tool["input_schema"];
    assert.ok(isRecord(schema) && isRecord(schema["properties"]), "the tool has a schema");
    return schema["properties"]["status"];
  }
  return assert.fail(`${TOOL} is missing from the request`);
}

scenario(
  "a relay request types an untyped string enum on every API, and other providers' requests stay as they were",
  PACKAGE,
  async ({ probeServer, rpc, server, world }) => {
    const relay = await startRelay(server, {
      inventory: inventoryOf([{ id: "k3.1-pro" }, { id: "claude-opus-4-6" }, { id: "other-1" }]),
      manifest: manifestOf([{ slug: "k3.1-pro", supported_reasoning_levels: ["low"] }]),
    });
    const completions = await startRelay(server, { inventory: inventoryOf([{ id: "chat-1" }]) });
    const probe = await probeServer(() => ({ text: "ok" }));
    const fixture = world.writeAgentFile("e2e-status-tool.ts", UNTYPED_ENUM_TOOL);
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
      claude: { baseURL: relay.v1, token: "tok", api: "anthropic-messages" },
      responses: { baseURL: relay.v1, token: "tok", api: "openai-responses" },
      completions: { baseURL: completions.v1, token: "tok", api: "openai-completions" },
    });
    const client = rpc(["--extension", fixture, ...modelArgs(world, "relay", "k3.1-pro")]);

    await client.prompt("codex");
    assert.deepEqual(statusSchema(relay.turns().at(-1)), TYPED);

    await client.send({ type: "set_model", provider: "claude", modelId: "claude-opus-4-6" });
    await client.prompt("anthropic");
    assert.deepEqual(statusSchema(relay.at("/v1/messages").at(-1)), TYPED);

    await client.send({ type: "set_model", provider: "responses", modelId: "other-1" });
    await client.prompt("responses");
    assert.deepEqual(statusSchema(relay.at("/v1/responses").at(-1)), TYPED);

    await client.send({ type: "set_model", provider: "completions", modelId: "chat-1" });
    await client.prompt("completions");
    assert.deepEqual(statusSchema(completions.at("/v1/chat/completions").at(-1)), TYPED);

    await client.send({ type: "set_model", provider: PROBE_PROVIDER, modelId: PROBE_MODEL });
    await client.prompt("probe");
    assert.deepEqual(statusSchema(probe.requests.at(-1)), UNTYPED);

    assert.deepEqual(client.extensionErrors(), []);
  },
);
