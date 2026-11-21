// A GPT-6.2 model that Pi does not mark as reasoning would otherwise send its
// system prompt as role system. The relay must see that text as developer, and
// the request must still omit top-level instructions. The local relay records
// the body only.
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

const IDENTITY =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const MANIFEST = manifestOf([
  { slug: "gpt-6.2-sol" },
  { slug: "gpt-6.1-sol" },
  { slug: "gpt-5.4" },
  { slug: "codex-mini" },
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
  "a GPT-6.2 system prompt stays a developer message and the request omits instructions",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: CODEX },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-6.2-sol"));

    await client.prompt("Hi");
    const body = turnBody(relay.turns().at(-1));
    const input = inputOf(relay.turns().at(-1));
    assert.equal("instructions" in body, false);
    assert.equal(body["model"], "gpt-6.2-sol");
    assert.equal(itemAt(input, 0)["role"], "developer");
    assert.ok(String(itemAt(input, 0)["content"]).includes(IDENTITY));
    assert.equal(
      input.some((item) => item["role"] === "system"),
      false,
    );
    assert.ok(Array.isArray(body["tools"]));

    const expectDeveloperPrompt = async (modelId: string): Promise<void> => {
      await client.send({ type: "set_model", provider: "relay", modelId });
      await client.prompt(modelId);
      const older = turnBody(relay.turns().at(-1));
      const olderInput = inputOf(relay.turns().at(-1));
      assert.equal("instructions" in older, false);
      assert.equal(older["model"], modelId);
      assert.equal(itemAt(olderInput, 0)["role"], "developer");
      assert.ok(String(itemAt(olderInput, 0)["content"]).includes(IDENTITY));
    };
    await expectDeveloperPrompt("gpt-6.1-sol");
    await expectDeveloperPrompt("gpt-5.4");
    await expectDeveloperPrompt("codex-mini");
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "native compaction of a GPT-6.2 system prompt also omits instructions",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.mergeSettings(MANUAL_COMPACTION);
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "RELAY-TOKEN", api: CODEX },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-6.2-sol"));
    await client.prompt("Remember BLUE-42.");
    await compact(client);

    const request = relay.compactions().at(0);
    const body = turnBody(request);
    const input = inputOf(request);
    assert.equal("instructions" in body, false);
    assert.equal(body["model"], "gpt-6.2-sol");
    assert.equal(itemAt(input, 0)["role"], "developer");
    assert.ok(String(itemAt(input, 0)["content"]).includes(IDENTITY));
    const trigger = input.at(-1);
    assert.ok(trigger !== undefined);
    assert.equal(trigger["type"], "compaction_trigger");
    assert.ok(JSON.stringify(input).includes("BLUE-42"));
    assert.deepEqual(client.extensionErrors(), []);
  },
);
