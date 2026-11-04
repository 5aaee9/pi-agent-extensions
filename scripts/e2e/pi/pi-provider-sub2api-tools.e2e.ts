// Server tools on the wire: they join Pi's own tools, once each, for their protocol.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import { PACKAGE, modelArgs } from "./pi-provider-sub2api-support.ts";

const MANIFEST = manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low", "high"] }]);

const RESPONSES_TOOLS = [
  { type: "web_search" },
  { type: "file_search", vector_store_ids: ["vs_docs"] },
  { type: "future_responses_hosted_tool", option: { enabled: true } },
];

const ANTHROPIC_TOOLS = [
  { type: "web_search_20250305", name: "web_search", max_uses: 4 },
  { type: "future_anthropic_server_tool", name: "future_tool" },
];

const toolsOf = (request: RecordedRequest | undefined): readonly JsonRecord[] => {
  if (request === undefined) return [];
  const { tools } = bodyOf(request);
  return Array.isArray(tools) ? tools.filter((tool: unknown) => isRecord(tool)) : [];
};

const ADD_WEB_SEARCH = `
export default function (pi) {
  pi.on("before_provider_request", (event) => {
    if (!Array.isArray(event.payload.input)) return undefined;
    return { ...event.payload, tools: [...(event.payload.tools ?? []), { type: "web_search" }] };
  });
}
`;

const hosted = (tools: readonly JsonRecord[]): readonly JsonRecord[] =>
  tools.filter((tool) => tool["type"] !== "function");

scenario(
  "server tools join Pi's tools on the wire, once each, for the protocol they belong to",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, {
      inventory: inventoryOf([{ id: "gpt-5.5" }, { id: "claude-opus-4-6" }, { id: "other-1" }]),
      manifest: MANIFEST,
    });
    const fixture = world.writeAgentFile("e2e-add-tool.ts", ADD_WEB_SEARCH);
    world.writeAgentFile("sub2api.json", {
      relay: {
        baseURL: relay.v1,
        token: "tok",
        serverTools: { responses: RESPONSES_TOOLS, anthropic: ANTHROPIC_TOOLS },
      },
    });
    const client = rpc(["--extension", fixture, ...modelArgs(world, "relay", "gpt-5.5")]);
    await client.prompt("codex");
    const codexTools = toolsOf(relay.turns().at(-1));
    assert.ok(
      codexTools.some((tool) => tool["name"] === "read"),
      "Pi's own tools stay",
    );
    assert.deepEqual(hosted(codexTools), RESPONSES_TOOLS);
    await client.send({ type: "set_model", provider: "relay", modelId: "other-1" });
    await client.prompt("responses");
    assert.deepEqual(hosted(toolsOf(relay.turns().at(-1))), RESPONSES_TOOLS);
    await client.send({ type: "set_model", provider: "relay", modelId: "claude-opus-4-6" });
    await client.prompt("anthropic");
    const anthropic = toolsOf(relay.at("/v1/messages").at(-1));
    assert.ok(
      anthropic.some((tool) => tool["name"] === "read"),
      "Pi's own tools stay",
    );
    assert.deepEqual(
      anthropic.filter((tool) => tool["input_schema"] === undefined),
      ANTHROPIC_TOOLS,
    );
  },
);
