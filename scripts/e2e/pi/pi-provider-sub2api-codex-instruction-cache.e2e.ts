// GPT-6.2 Codex requests can opt into keeping the pinned default in input.
// The local relay only records the body; it does not bill tokens.
import assert from "node:assert/strict";

import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import {
  CODEX,
  MANUAL_COMPACTION,
  PACKAGE,
  inputOf,
  modelArgs,
} from "./pi-provider-sub2api-support.ts";
import { compact } from "./pi-provider-sub2api-compaction-support.ts";
import {
  CODEX_TURN_INSTRUCTIONS,
  GPT62_SOL_INSTRUCTIONS,
} from "../../../pi-provider-sub2api/codex-instruction-cache.ts";

const IDENTITY =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const MANIFEST = manifestOf([
  { slug: "gpt-6.2-sol", supported_reasoning_levels: ["low", "high"] },
  { slug: "gpt-5.4" },
]);

function turnBody(request: RecordedRequest | undefined): JsonRecord {
  assert.ok(request !== undefined, "a request reached the server");
  return bodyOf(request);
}

function itemAt(input: readonly JsonRecord[], index: number): JsonRecord {
  const item = input[index];
  assert.ok(item !== undefined, `missing input item ${String(index)}`);
  return item;
}

scenario(
  "cacheCodexInstructions puts the pinned GPT-6.2 default ahead of Pi's prompt and leaves other models unchanged",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    const shared = { baseURL: relay.v1, token: "tok", api: CODEX };
    world.writeAgentFile("sub2api.json", {
      cached: { ...shared, cacheCodexInstructions: true },
      plain: shared,
    });
    const client = rpc(modelArgs(world, "cached", "gpt-6.2-sol"));

    await client.prompt("Hi");
    const cached = turnBody(relay.turns().at(-1));
    const input = inputOf(relay.turns().at(-1));
    assert.equal(cached["instructions"], CODEX_TURN_INSTRUCTIONS);
    assert.equal(cached["model"], "gpt-6.2-sol");
    assert.equal(itemAt(input, 0)["role"], "developer");
    assert.equal(itemAt(input, 0)["content"], GPT62_SOL_INSTRUCTIONS);
    assert.equal(itemAt(input, 1)["role"], "developer");
    assert.ok(String(itemAt(input, 1)["content"]).includes(IDENTITY));
    assert.equal(
      input.some((item) => item["role"] === "system"),
      false,
    );
    assert.ok(Array.isArray(cached["tools"]));

    await client.send({ type: "set_model", provider: "cached", modelId: "gpt-5.4" });
    await client.prompt("older");
    const older = turnBody(relay.turns().at(-1));
    assert.equal("instructions" in older, false);
    assert.equal(JSON.stringify(older).includes(GPT62_SOL_INSTRUCTIONS), false);

    await client.send({ type: "set_model", provider: "plain", modelId: "gpt-6.2-sol" });
    await client.prompt("plain");
    const plain = turnBody(relay.turns().at(-1));
    assert.equal("instructions" in plain, false);
    assert.equal(
      itemAt(inputOf(relay.turns().at(-1)), 0)["content"] === GPT62_SOL_INSTRUCTIONS,
      false,
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "cacheCodexInstructions rewrites a native compaction request for a covered model",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.mergeSettings(MANUAL_COMPACTION);
    world.writeAgentFile("sub2api.json", {
      cached: {
        baseURL: relay.v1,
        token: "RELAY-TOKEN",
        api: CODEX,
        cacheCodexInstructions: true,
      },
    });
    const client = rpc(modelArgs(world, "cached", "gpt-6.2-sol"));
    await client.prompt("Remember BLUE-42.");
    await compact(client);

    const request = relay.compactions().at(0);
    const body = turnBody(request);
    const input = inputOf(request);
    assert.equal(body["instructions"], CODEX_TURN_INSTRUCTIONS);
    assert.equal(body["model"], "gpt-6.2-sol");
    assert.equal(itemAt(input, 0)["content"], GPT62_SOL_INSTRUCTIONS);
    const trigger = input.at(-1);
    assert.ok(trigger !== undefined);
    assert.equal(trigger["type"], "compaction_trigger");
    assert.ok(JSON.stringify(input).includes("BLUE-42"));
    assert.deepEqual(client.extensionErrors(), []);
  },
);
