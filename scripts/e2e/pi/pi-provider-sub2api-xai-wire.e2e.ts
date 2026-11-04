// What an xAI entry sends: only efforts a model advertises, no stored responses, and
// local tools that replay with their encrypted reasoning.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { headerOf, inventoryOf, startRelay } from "./servers-sub2api.ts";
import { textReply, toolCallReply } from "./servers-sub2api-replies.ts";
import { PACKAGE, inSequence, inputOf, modelArgs } from "./pi-provider-sub2api-support.ts";
import {
  CACHE_HEADER,
  ENCRYPTED,
  LOW_TO_XHIGH,
  openWith,
  xaiRelay,
} from "./pi-provider-sub2api-xai-support.ts";

interface LevelRow {
  readonly label: string;
  readonly fields: JsonRecord;
  readonly levels: readonly string[];
}

const LEVEL_ROWS: readonly LevelRow[] = [
  {
    label: "published",
    fields: { supportsReasoningEffort: true, reasoningEfforts: LOW_TO_XHIGH },
    levels: ["low", "medium", "high", "xhigh"],
  },
  {
    label: "false-flag",
    fields: { supportsReasoningEffort: false, reasoningEfforts: LOW_TO_XHIGH },
    levels: ["off"],
  },
  { label: "one-effort", fields: { reasoningEfforts: [{ value: "high" }] }, levels: ["high"] },
  { label: "true-flag", fields: { supportsReasoningEffort: true }, levels: ["off"] },
  { label: "empty-bound", fields: { reasoningEfforts: [] }, levels: ["off"] },
  {
    label: "unknown-bound",
    fields: { reasoningEfforts: [{ value: "max" }, { value: "ultra" }] },
    levels: ["off"],
  },
  {
    label: "malformed",
    fields: {
      reasoningEfforts: [{ value: " LOW " }, 42, null, { label: "x" }, "high", { value: "high" }],
    },
    levels: ["low", "high"],
  },
  {
    label: "snake-case",
    fields: {
      reasoningEfforts: "invalid",
      supported_reasoning_levels: ["none", { effort: "Medium" }, "turbo"],
    },
    levels: ["off", "medium"],
  },
  { label: "camel-case", fields: { supportedReasoningLevels: ["low"] }, levels: ["low"] },
  {
    label: "primary-wins",
    fields: { reasoningEfforts: [], supportedReasoningLevels: ["low"] },
    levels: ["off"],
  },
  {
    label: "explicit-none",
    fields: { reasoningEfforts: [{ value: "none" }, { value: "low" }] },
    levels: ["off", "low"],
  },
  { label: "no-evidence", fields: {}, levels: ["off"] },
];

scenario(
  "Pi's selectable levels follow the relay's reasoning metadata",
  PACKAGE,
  async (context) => {
    await xaiRelay(
      context,
      LEVEL_ROWS.map(({ label, fields }) => ({ id: `relay-${label}`, ...fields })),
    );
    const client = openWith(context);
    const seen = await inSequence(LEVEL_ROWS, async ({ label }) => {
      await client.send({ type: "set_model", provider: "grok", modelId: `relay-${label}` });
      const response = await client.send({ type: "get_available_thinking_levels" });
      const data = response["data"];
      return { label, levels: isRecord(data) ? data["levels"] : undefined };
    });
    assert.deepEqual(
      seen,
      LEVEL_ROWS.map(({ label, levels }) => ({ label, levels })),
    );
  },
);

const WIRE_INVENTORY = [
  { id: "grok-e2e-listed", supportsReasoningEffort: true, reasoningEfforts: LOW_TO_XHIGH },
  { id: "grok-e2e-flag", supportsReasoningEffort: true },
  { id: "grok-e2e-none", reasoningEfforts: [{ value: "none" }, { value: "low" }] },
  { id: "plain-e2e" },
];

interface WireRow {
  readonly model: string;
  readonly level: string;
  readonly effort: string | undefined;
  readonly encrypted: boolean;
}

const WIRE_ROWS: readonly WireRow[] = [
  { model: "grok-e2e-listed", level: "xhigh", effort: "xhigh", encrypted: true },
  { model: "grok-e2e-listed", level: "high", effort: "high", encrypted: true },
  { model: "grok-e2e-listed", level: "max", effort: "xhigh", encrypted: true },
  { model: "grok-e2e-flag", level: "off", effort: undefined, encrypted: true },
  { model: "grok-e2e-none", level: "off", effort: "none", encrypted: true },
  { model: "plain-e2e", level: "off", effort: undefined, encrypted: false },
];

const effortOf = (body: JsonRecord): unknown =>
  isRecord(body["reasoning"]) ? body["reasoning"]["effort"] : undefined;

function assertWireBasics(turn: RecordedRequest | undefined): JsonRecord {
  assert.ok(turn !== undefined);
  assert.equal(turn.url, "/v1/responses");
  assert.equal(headerOf(turn, "authorization"), "Bearer sk-grok");
  assert.equal(headerOf(turn, CACHE_HEADER), "off");
  const body = bodyOf(turn);
  assert.equal(body["store"], false);
  return body;
}

scenario(
  "the wire carries only efforts a model advertises, stores nothing, and keeps encrypted reasoning",
  PACKAGE,
  async (context) => {
    const relay = await xaiRelay(context, WIRE_INVENTORY);
    const client = openWith(context);
    await inSequence(WIRE_ROWS, async ({ model, level, effort, encrypted }) => {
      await client.send({ type: "new_session" });
      await client.send({ type: "set_model", provider: "grok", modelId: model });
      await client.send({ type: "set_thinking_level", level });
      await client.prompt(`hello ${model}`);
      const body = assertWireBasics(relay.turns().at(-1));
      assert.equal(body["model"], model);
      assert.equal(effortOf(body), effort, `${model} at ${level}`);
      assert.deepEqual(body["include"], encrypted ? [ENCRYPTED] : undefined, model);
    });
  },
);

const HOOK_EXTENSION = `
export default function (pi) {
  pi.on("before_provider_headers", (event) => {
    event.headers["X-Sub2API-Grok-Client-Tool-Cache"] = "prefer-cache";
  });
  pi.on("before_provider_request", (event) => ({
    ...event.payload,
    store: true,
    include: ["message.output_text.logprobs", ${JSON.stringify(ENCRYPTED)}],
    reasoning: { effort: "max" },
    metadata: { caller: "hook" },
  }));
}
`;

scenario(
  "another extension's payload hook cannot re-enable storage or send an unsupported effort",
  PACKAGE,
  async (context) => {
    const relay = await xaiRelay(context, WIRE_INVENTORY);
    const fixture = context.world.writeAgentFile("e2e-hook.ts", HOOK_EXTENSION);
    const client = openWith(context, "--extension", fixture);
    await client.send({ type: "set_model", provider: "grok", modelId: "grok-e2e-listed" });
    await client.send({ type: "set_thinking_level", level: "high" });
    await client.prompt("reasoning model");
    const reasoning = assertWireBasics(relay.turns().at(-1));
    assert.equal(effortOf(reasoning), undefined, "max is not advertised");
    assert.deepEqual(reasoning["include"], ["message.output_text.logprobs", ENCRYPTED]);
    assert.deepEqual(reasoning["metadata"], { caller: "hook" });

    await client.send({ type: "set_model", provider: "grok", modelId: "plain-e2e" });
    await client.prompt("plain model");
    const plain = assertWireBasics(relay.turns().at(-1));
    assert.equal(effortOf(plain), undefined, "a model without reasoning takes no reasoning field");
  },
);

scenario(
  "24-hour cache retention requested through the environment is left out for xAI models only",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, { inventory: inventoryOf([{ id: "grok-e2e" }]) });
    const other = await startRelay(server, { inventory: inventoryOf([{ id: "grok-e2e" }]) });
    world.writeAgentFile("sub2api.json", {
      grok: { baseURL: relay.v1, token: "tok", api: "xai" },
      plain: { baseURL: other.v1, token: "tok", api: "openai-responses" },
    });
    const client = rpc(modelArgs(world, "grok", "grok-e2e"), {
      env: { PI_CACHE_RETENTION: "long" },
    });
    await client.prompt("hello");
    const body = bodyOf(relay.turns().at(-1) ?? assert.fail());
    assert.equal(typeof body["prompt_cache_key"], "string");
    assert.equal(body["prompt_cache_retention"], undefined);
    await client.send({ type: "set_model", provider: "plain", modelId: "grok-e2e" });
    await client.prompt("control");
    const control = bodyOf(other.turns().at(-1) ?? assert.fail());
    assert.equal(control["prompt_cache_retention"], "24h", "the environment did take effect");
  },
);

const LOCAL_TOOLS_EXTENSION = `
const parameters = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
export default function (pi) {
  for (const name of ["web_search", "x_search"]) {
    pi.registerTool({
      name,
      label: name,
      description: "Local " + name,
      parameters,
      async execute() {
        return { content: [{ type: "text", text: "local result" }], details: {} };
      },
    });
  }
}
`;

const toolNames = (body: JsonRecord): readonly unknown[] =>
  (Array.isArray(body["tools"]) ? body["tools"] : [])
    .filter((tool: unknown) => isRecord(tool) && tool["type"] === "function")
    .map((tool: unknown) => (isRecord(tool) ? tool["name"] : undefined));

scenario(
  "local tools named web_search and x_search stay local and replay encrypted reasoning",
  PACKAGE,
  async (context) => {
    const relay = await xaiRelay(context, [{ id: "grok-e2e", reasoningEfforts: LOW_TO_XHIGH }]);
    const fixture = context.world.writeAgentFile("e2e-tools.ts", LOCAL_TOOLS_EXTENSION);
    relay.queueTurns(
      toolCallReply({
        name: "web_search",
        args: JSON.stringify({ query: "pi" }),
        encryptedReasoning: "opaque-reasoning",
      }),
      textReply("done"),
    );
    const client = openWith(context, "--extension", fixture);
    await client.send({ type: "set_model", provider: "grok", modelId: "grok-e2e" });
    await client.send({ type: "set_thinking_level", level: "high" });
    await client.prompt("search pi");
    assert.equal(relay.turns().length, 2);
    for (const turn of relay.turns()) {
      const body = assertWireBasics(turn);
      assert.ok(toolNames(body).includes("web_search"));
      assert.ok(toolNames(body).includes("x_search"));
      assert.deepEqual(body["include"], [ENCRYPTED]);
    }
    const replayed = inputOf(relay.turns().at(1));
    const ofType = (type: string): JsonRecord | undefined =>
      replayed.find((item) => item["type"] === type);
    assert.equal(ofType("reasoning")?.["encrypted_content"], "opaque-reasoning");
    assert.equal(ofType("function_call")?.["name"], "web_search");
    assert.equal(ofType("function_call_output")?.["output"], "local result");
  },
);
