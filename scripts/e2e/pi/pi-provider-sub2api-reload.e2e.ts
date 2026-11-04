// `/reload` and `/sub2api-refresh` from the outside: a rotated credential, an API
// switch, and a removed relay leave nothing of the previous registration behind.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { modelKeys, modelsOf } from "./pi.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { headerOf, inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import {
  CODEX,
  PACKAGE,
  RELOAD_EXTENSION,
  modelArgs,
  reload,
  runCommand,
} from "./pi-provider-sub2api-support.ts";

/** Well short of the usage request's own 30-second timeout, which would also close it. */
const ABORT_BOUND_MS = 10_000;

const MODELS = {
  manifest: manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low", "high"] }]),
  inventory: inventoryOf([{ id: "gpt-5.5" }]),
};

const bearers = (requests: readonly RecordedRequest[]): readonly (string | undefined)[] => [
  ...new Set(requests.map((request) => headerOf(request, "authorization"))),
];

/** What only Pi's Codex adapter sends: a compressed body with top-level instructions. */
const usedCodexAdapter = (request: RecordedRequest | undefined): boolean =>
  headerOf(request, "content-encoding") === "zstd";

async function assertForgotten(client: RpcClient, relay: Relay): Promise<void> {
  await reload(client);
  const removed = await client.send({ type: "get_available_models" });
  assert.ok(!modelKeys(removed).includes("relay/gpt-5.5"), "a removed relay must not be listed");
  const before = relay.requests.length;
  await client.send({ type: "prompt", message: "after removal" });
  await client.close();
  assert.deepEqual(
    relay.requests.slice(before).map((request) => request.url),
    [],
  );
}

scenario(
  "/reload sends only the current token through the current handler and forgets a removed relay",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, MODELS);
    const configure = (token: string, api: string): void => {
      world.writeAgentFile("sub2api.json", { relay: { baseURL: relay.v1, token, api } });
    };
    configure("TOKEN-A", CODEX);
    const fixture = world.writeAgentFile("e2e-reload.ts", RELOAD_EXTENSION);
    const client = rpc(["--extension", fixture, ...modelArgs(world, "relay", "gpt-5.5")]);
    await client.prompt("before any reload");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer TOKEN-A");

    await reload(client);
    await client.prompt("unchanged");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer TOKEN-A");
    assert.ok(usedCodexAdapter(relay.turns().at(-1)));

    configure("TOKEN-B", CODEX);
    await reload(client);
    await client.prompt("rotated");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer TOKEN-B");
    assert.ok(usedCodexAdapter(relay.turns().at(-1)));

    configure("TOKEN-C", "openai-responses");
    await reload(client);
    const switched = relay.requests.length;
    await client.prompt("switched");
    const afterSwitch = relay.requests.slice(switched);
    assert.deepEqual(bearers(afterSwitch), ["Bearer TOKEN-C"]);
    assert.ok(
      !usedCodexAdapter(relay.turns().at(-1)),
      "plain Responses must not use the Codex handler",
    );
    assert.equal(headerOf(relay.turns().at(-1), "chatgpt-account-id"), undefined);
    const listed = modelsOf(await client.send({ type: "get_available_models" }));
    assert.deepEqual(
      listed.filter((model) => model["provider"] === "relay").map((model) => model["api"]),
      ["openai-responses"],
    );

    world.writeAgentFile("sub2api.json", {});
    await assertForgotten(client, relay);
  },
);

scenario(
  "/sub2api-refresh drops the Codex handler when a relay's last Codex model disappears",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, { inventory: inventoryOf([{ id: "gpt-5.5" }]) });
    world.writeAgentFile("sub2api.json", { relay: { baseURL: relay.v1, token: "TOKEN" } });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    await client.prompt("through Codex");
    assert.ok(usedCodexAdapter(relay.turns().at(-1)));

    relay.route({ inventory: inventoryOf([{ id: "other-1" }]) });
    await runCommand(client, "/sub2api-refresh", "Refreshed discovered models");
    await client.send({ type: "set_model", provider: "relay", modelId: "other-1" });
    await client.prompt("through Responses");
    const turn = relay.turns().at(-1);
    assert.ok(!usedCodexAdapter(turn), "the Codex handler must not serve a plain Responses model");
    assert.equal(headerOf(turn, "authorization"), "Bearer TOKEN");
  },
);

scenario(
  "/reload aborts an in-flight usage request and the next process state still works",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const { promise: never } = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const relay = await startRelay(server, {
      ...MODELS,
      usage: () => ({
        ...json({ mode: "quota" }),
        gate: async (): Promise<void> => {
          await never;
        },
        onClientClose: aborted.resolve,
      }),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "TOKEN", api: CODEX },
    });
    const fixture = world.writeAgentFile("e2e-reload.ts", RELOAD_EXTENSION);
    const client = rpc(["--extension", fixture, ...modelArgs(world, "relay", "gpt-5.5")]);
    await relay.waitFor("/usage", 1);
    await reload(client);
    const closed = await Promise.race([
      aborted.promise.then(() => true),
      delay(ABORT_BOUND_MS, false, { ref: false }),
    ]);
    assert.equal(closed, true, "the request must go before its own timeout ends it");
    await client.prompt("after the abort");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer TOKEN");
  },
);

scenario(
  "/new keeps the relay model selectable and working",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, MODELS);
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "TOKEN", api: CODEX },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    await client.prompt("first session");
    await client.send({ type: "new_session" });
    const state = await client.send({ type: "get_state" });
    assert.ok(JSON.stringify(state).includes('"gpt-5.5"'), JSON.stringify(state));
    const before = relay.turns().length;
    await client.prompt("second session");
    assert.equal(relay.turns().length, before + 1);
    assert.ok(usedCodexAdapter(relay.turns().at(-1)));
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer TOKEN");
  },
);
