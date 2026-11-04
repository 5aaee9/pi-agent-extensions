// The billing multiplier: cached with the models, scaling prices, and kept on failure.
// Prices come from a seeded catalog entry for a model no live catalog has.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { billingReply } from "./servers-sub2api-replies.ts";
import {
  DISCOVERY_TTL_MS,
  PACKAGE,
  discoveryEntry,
  listedModel,
  requireModel,
  runCommand,
  seedDiscovery,
  seedStore,
  until,
} from "./pi-provider-sub2api-support.ts";
import { opened } from "./pi-provider-sub2api-catalog-support.ts";

const PRICED = "gpt-e2e-priced";
const PRICE = {
  input: 10,
  output: 20,
  cacheRead: 2,
  cacheWrite: 0,
  tiers: [{ inputTokensAbove: 50_000, input: 40, output: 80, cacheRead: 8, cacheWrite: 0 }],
};
const pricedCatalog = {
  openai: [
    {
      id: PRICED,
      name: PRICED,
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 100_000,
      maxTokens: 10_000,
      cost: PRICE,
    },
  ],
};

const pricedInput = async (client: RpcClient): Promise<unknown> => {
  const model = await listedModel(client, "relay", PRICED);
  return isRecord(model?.["cost"]) ? model["cost"]["input"] : undefined;
};

async function pricedRelay(context: Scenario, billing: () => Reply): Promise<Relay> {
  const { server, world } = context;
  seedStore(world, pricedCatalog);
  const relay = await startRelay(server, {
    inventory: inventoryOf([{ id: PRICED, context_window: 100_000, max_tokens: 10_000 }]),
    billing,
  });
  world.writeAgentFile("sub2api.json", {
    relay: { baseURL: relay.v1, token: "tok", api: "openai-responses" },
  });
  return relay;
}

scenario(
  "the billing multiplier is cached with the models, scales prices, and is skipped while fresh",
  PACKAGE,
  async (context) => {
    let rate = 0.5;
    const relay = await pricedRelay(context, () => billingReply(rate));
    const first = opened(context);
    assert.equal(await pricedInput(first), 5);
    const billed = await requireModel(first, "relay", PRICED);
    assert.deepEqual(billed["cost"], {
      input: 5,
      output: 10,
      cacheRead: 1,
      cacheWrite: 0,
      tiers: [{ inputTokensAbove: 50_000, input: 20, output: 40, cacheRead: 4, cacheWrite: 0 }],
    });
    assert.equal(discoveryEntry(context.world, "relay")["priceMultiplier"], 0.5);
    await first.close();

    const billingRequests = relay.at("/v1/sub2api/billing").length;
    const second = opened(context);
    assert.equal(await pricedInput(second), 5);
    await second.close();
    assert.equal(relay.at("/v1/sub2api/billing").length, billingRequests);

    rate = 0.25;
    const third = opened(context);
    assert.equal(await pricedInput(third), 5);
    const refreshed = await runCommand(third, "/sub2api-refresh", "Refreshed discovered models");
    assert.ok(refreshed.includes("relay (1)"), refreshed);
    assert.equal(await pricedInput(third), 2.5);
    assert.equal(discoveryEntry(context.world, "relay")["priceMultiplier"], 0.25);
  },
);

scenario(
  "a cached list without a multiplier loads at once and takes the billing rate when it arrives",
  PACKAGE,
  async (context) => {
    const { promise: release, resolve } = Promise.withResolvers<void>();
    const relay = await pricedRelay(context, () => ({
      ...billingReply(0.25),
      gate: async (): Promise<void> => {
        await release;
      },
    }));
    seedDiscovery(context.world, {
      relay: { baseUrl: relay.v1, api: "openai-responses", models: [{ id: PRICED, name: PRICED }] },
    });
    const client = opened(context);
    assert.equal(await pricedInput(client), 10);
    await relay.waitFor("/v1/sub2api/billing", 1);
    resolve();
    await until(async () => (await pricedInput(client)) === 2.5, "the billed price");
    assert.equal(relay.at("/v1/models").length, 0, "the model list is not refetched");
    await until(
      () => discoveryEntry(context.world, "relay")["priceMultiplier"] === 0.25,
      "the cached multiplier",
    );
  },
);

scenario(
  "a failed background billing refresh keeps the cached multiplier while models update",
  PACKAGE,
  async (context) => {
    const relay = await pricedRelay(context, () => json({ error: "down" }, 503));
    relay.route({
      inventory: inventoryOf([{ id: PRICED, context_window: 1111, max_tokens: 100 }]),
    });
    seedDiscovery(context.world, {
      relay: {
        baseUrl: relay.v1,
        api: "openai-responses",
        ageMs: DISCOVERY_TTL_MS,
        priceMultiplier: 0.4,
        models: [{ id: PRICED, name: PRICED, contextWindow: 100_000, maxTokens: 10_000 }],
      },
    });
    const client = opened(context);
    await until(
      async () => (await listedModel(client, "relay", PRICED))?.["contextWindow"] === 1111,
      "the refreshed model",
    );
    assert.equal(await pricedInput(client), 4);
    assert.equal(discoveryEntry(context.world, "relay")["priceMultiplier"], 0.4);
    await until(
      () => client.stderr().includes("Kept the last cached price multiplier"),
      "the billing failure on stderr",
    );
  },
);
