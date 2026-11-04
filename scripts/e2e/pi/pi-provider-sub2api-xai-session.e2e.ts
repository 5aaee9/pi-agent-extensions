// Everything an xAI entry deliberately refuses within a session.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { modelsOf } from "./pi.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import {
  MANUAL_COMPACTION,
  PACKAGE,
  compactionEntries,
  findModel,
  inSequence,
  runCommand,
} from "./pi-provider-sub2api-support.ts";
import { openWith } from "./pi-provider-sub2api-xai-support.ts";

const SESSION_CONFIG = (grok: Relay, relay: Relay, codex: Relay): JsonRecord => ({
  grok: {
    baseURL: grok.v1,
    token: "sk-grok",
    api: "xai",
    requestModes: { serviceTier: "fast", daybreak: "blue" },
    modelRequestModes: { "gpt-5.5": { serviceTier: "ultrafast" } },
  },
  relay: { baseURL: relay.v1, token: "sk-relay", api: "openai-responses" },
  codex: { baseURL: codex.v1, token: "sk-codex", api: "openai-codex-responses" },
});

interface SessionWorld {
  readonly grok: Relay;
  readonly relay: Relay;
  readonly configPath: string;
  readonly client: RpcClient;
}

async function sessionWorld(context: Scenario): Promise<SessionWorld> {
  const { server, world } = context;
  world.mergeSettings(MANUAL_COMPACTION);
  const grok = await startRelay(server, {
    inventory: inventoryOf([{ id: "grok-e2e" }, { id: "gpt-5.5" }]),
  });
  const relay = await startRelay(server, { inventory: inventoryOf([{ id: "gpt-e2e-relay" }]) });
  const codex = await startRelay(server, {
    manifest: manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low"] }]),
  });
  const configPath = world.writeAgentFile("sub2api.json", SESSION_CONFIG(grok, relay, codex));
  return { grok, relay, configPath, client: openWith(context) };
}

const COMMANDS = [
  ["toggle-fast", "/toggle-fast"],
  ["toggle-ultrafast", "/toggle-ultrafast"],
  ["toggle-daybreak", "/toggle-daybreak"],
  ["toggle-ultra", "/toggle-ultra"],
  ["sub2api-save", "/sub2api-save provider"],
] as const;

scenario(
  "saved modes stay inactive and every mode command refuses, for any model ID on an xAI entry",
  PACKAGE,
  async (context) => {
    const { client, configPath, grok } = await sessionWorld(context);
    const before = readFileSync(configPath, "utf8");
    await inSequence(["grok-e2e", "gpt-5.5"], async (model) => {
      await client.send({ type: "set_model", provider: "grok", modelId: model });
      await inSequence(COMMANDS, async ([name, command]) => {
        const notice = await runCommand(client, command, "is not supported for the selected xAI");
        assert.equal(notice, `/${name} is not supported for the selected xAI entry grok.`);
      });
      await client.prompt(`hello ${model}`);
      const body = bodyOf(grok.turns().at(-1) ?? assert.fail());
      assert.equal(body["service_tier"], undefined, model);
      assert.equal(body["access_programs"], undefined, model);
    });
    const state = await client.send({ type: "get_state" });
    assert.ok(isRecord(state["data"]));
    assert.notEqual(
      state["data"]["thinkingLevel"],
      "max",
      "/toggle-ultra must not change the level",
    );
    assert.equal(readFileSync(configPath, "utf8"), before);
  },
);

scenario(
  "another provider's temporary modes survive a switch through an xAI model",
  PACKAGE,
  async (context) => {
    const { client, relay, grok } = await sessionWorld(context);
    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-e2e-relay" });
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    await client.prompt("on the relay");
    assert.equal(bodyOf(relay.turns().at(-1) ?? assert.fail())["service_tier"], "priority");
    await client.send({ type: "set_model", provider: "grok", modelId: "grok-e2e" });
    await client.prompt("on xAI");
    assert.equal(bodyOf(grok.turns().at(-1) ?? assert.fail())["service_tier"], undefined);
    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-e2e-relay" });
    await client.prompt("back on the relay");
    assert.equal(bodyOf(relay.turns().at(-1) ?? assert.fail())["service_tier"], "priority");
  },
);

scenario(
  "xAI compaction stays Pi's textual summary and /openai-compress refuses",
  PACKAGE,
  async (context) => {
    const { client, grok } = await sessionWorld(context);
    await client.send({ type: "set_model", provider: "grok", modelId: "grok-e2e" });
    await client.prompt("hello");
    const response = await client.send({ type: "compact" });
    assert.equal(response["success"], true, JSON.stringify(response));
    assert.equal(grok.summaries().length, 1);
    assert.equal(grok.compactions().length, 0);
    const entry = compactionEntries(context.world).at(-1);
    assert.ok(isRecord(entry?.["details"]));
    assert.equal(entry["details"]["kind"], undefined);
    await runCommand(client, "/openai-compress", "requires a Sub2API OpenAI Codex model");
    assert.equal(grok.compactions().length, 0);
    const listed = modelsOf(await client.send({ type: "get_available_models" }));
    assert.equal(findModel(listed, "grok", "grok-e2e")?.["api"], "openai-responses");
  },
);
