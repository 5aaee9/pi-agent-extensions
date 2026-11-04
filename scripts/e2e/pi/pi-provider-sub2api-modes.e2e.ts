// Request modes on the wire: toggles stay in memory, and each protocol only ever
// sends the modes it supports.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { isRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf, json } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { headerOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import {
  PACKAGE,
  inSequence,
  modelArgs,
  reload,
  runCommand,
} from "./pi-provider-sub2api-support.ts";
import {
  COMPLETIONS_MODEL,
  MODEL_A,
  MODEL_B,
  NON_OPENAI,
  modesWorld,
  wireModes,
} from "./pi-provider-sub2api-modes-support.ts";

scenario(
  "toggles apply to one model in memory, leave the file alone, and reset on /reload",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile(
      "sub2api.json",
      modes.entry({ requestModes: { serviceTier: "fast" } }),
    );
    const before = readFileSync(modes.configPath, "utf8");
    const client = modes.open();
    await runCommand(client, "/toggle-ultrafast", "Ultrafast mode enabled");
    await runCommand(client, "/toggle-daybreak", "Daybreak Blue enabled");
    assert.deepEqual(await wireModes(client, modes.relay, MODEL_A), {
      tier: "ultrafast",
      daybreak: "daybreak_blue",
    });
    assert.deepEqual(await wireModes(client, modes.relay, MODEL_B), {
      tier: "priority",
      daybreak: undefined,
    });
    assert.equal(readFileSync(modes.configPath, "utf8"), before);
    await client.send({ type: "set_model", provider: "relay", modelId: MODEL_A });
    await reload(client);
    assert.deepEqual(await wireModes(client, modes.relay, MODEL_A), {
      tier: "priority",
      daybreak: undefined,
    });
  },
);

scenario("unsupported toggles warn and change nothing", PACKAGE, async (context) => {
  const modes = await modesWorld(context);
  context.world.writeAgentFile("sub2api.json", modes.entry());
  const client = modes.open();
  await client.send({ type: "set_model", provider: "completions", modelId: COMPLETIONS_MODEL });
  await runCommand(client, "/toggle-ultrafast", "Ultrafast mode is not supported");
  await runCommand(client, "/toggle-daybreak", "Daybreak is not supported");
  await client.prompt("nothing active");
  const silent = bodyOf(modes.completions.at("/v1/chat/completions").at(-1) ?? assert.fail());
  assert.equal(silent["service_tier"], undefined);
  assert.equal(silent["access_programs"], undefined);
  await runCommand(client, "/toggle-fast", "Fast mode enabled");
  await client.prompt("fast is supported here");
  const fast = bodyOf(modes.completions.at("/v1/chat/completions").at(-1) ?? assert.fail());
  assert.equal(fast["service_tier"], "priority");

  await client.send({ type: "set_model", provider: "relay", modelId: NON_OPENAI });
  await runCommand(client, "/toggle-fast", "Fast mode is not supported");
  assert.deepEqual(await wireModes(client, modes.relay, NON_OPENAI), {
    tier: undefined,
    daybreak: undefined,
  });
});

const CODEX_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const reasoningOf = (relay: Relay): unknown => {
  const reasoning = bodyOf(relay.turns().at(-1) ?? assert.fail())["reasoning"];
  return isRecord(reasoning) ? reasoning["effort"] : undefined;
};

scenario(
  "/toggle-ultra remaps max to ultra on the Codex wire, with the relay's own endpoint and token",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, {
      manifest: manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: CODEX_LEVELS }]),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "RELAY-TOKEN", api: "openai-codex-responses" },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    await client.send({ type: "set_thinking_level", level: "max" });
    await client.prompt("max by default");
    assert.equal(reasoningOf(relay), "max", "max must not silently send ultra");

    await runCommand(client, "/toggle-ultra", "Ultra reasoning enabled");
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    await client.prompt("ultra");
    assert.equal(reasoningOf(relay), "ultra");
    const turn = relay.turns().at(-1);
    assert.equal(headerOf(turn, "authorization"), "Bearer RELAY-TOKEN");
    assert.equal(headerOf(turn, "chatgpt-account-id"), undefined);
    assert.ok(turn !== undefined);
    assert.equal(turn.url, "/v1/responses");
    assert.equal(bodyOf(turn)["service_tier"], "priority");

    await runCommand(client, "/toggle-ultra", "Ultra reasoning disabled");
    await client.prompt("max again");
    assert.equal(reasoningOf(relay), "max");
  },
);

scenario(
  "usage refreshes once per turn on the root route first, then falls through to /v1/usage",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, {
      manifest: manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low"] }]),
    });
    relay.route({
      usage: (request) => (request.url === "/usage" ? json({}, 404) : json({ mode: "quota" })),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    await relay.waitFor("/v1/usage", 1);
    const counts = await inSequence(["one", "two"], async (message) => {
      const before = relay.at("/v1/usage").length;
      await client.prompt(message);
      await relay.waitFor("/v1/usage", before + 1);
      return relay.at("/v1/usage").length - before;
    });
    assert.deepEqual(counts, [1, 1]);
    assert.equal(headerOf(relay.at("/v1/usage").at(-1), "authorization"), "Bearer tok");
  },
);

const SLOW_USAGE_MS = 6_000;

scenario(
  "a slow usage endpoint gets more than the discovery timeout to answer",
  PACKAGE,
  async ({ rpc, server, world }) => {
    let aborted = false;
    const answered = Promise.withResolvers<void>();
    const relay = await startRelay(server, {
      manifest: manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low"] }]),
      usage: (): Reply => ({
        ...json({ mode: "quota" }),
        gate: async (): Promise<void> => {
          await delay(SLOW_USAGE_MS);
          answered.resolve();
        },
        onClientClose: () => {
          aborted = true;
        },
      }),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    rpc(modelArgs(world, "relay", "gpt-5.5"));
    await answered.promise;
    assert.equal(aborted, false, "the client must still be waiting after six seconds");
  },
);
