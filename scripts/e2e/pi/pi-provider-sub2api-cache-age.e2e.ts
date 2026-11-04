// How the age of the discovery cache decides what happens at startup.
import assert from "node:assert/strict";

import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import {
  CODEX,
  DISCOVERY_TTL_MS,
  PACKAGE,
  discoveryEntry,
  listedModel,
  seedDiscovery,
  until,
} from "./pi-provider-sub2api-support.ts";
import { opened } from "./pi-provider-sub2api-catalog-support.ts";

const ASTRA_MODEL = "astra-preview";
const ASTRA = {
  slug: ASTRA_MODEL,
  context_window: 262_144,
  supported_reasoning_levels: [{ effort: "low" }],
};

const SEEDED_MODEL = { id: "cached-old", name: "cached-old", contextWindow: 1000, maxTokens: 100 };

scenario(
  "a cache younger than 12 hours is kept without discovery, and only a missing multiplier asks billing",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, { manifest: manifestOf([ASTRA]) });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: relay.v1, token: "tok", api: CODEX },
    });
    seedDiscovery(world, {
      codex: {
        baseUrl: relay.v1,
        api: CODEX,
        ageMs: DISCOVERY_TTL_MS - 60_000,
        models: [SEEDED_MODEL],
      },
    });
    const client = opened(context);
    assert.notEqual(await listedModel(client, "codex", "cached-old"), undefined);
    await until(
      () => discoveryEntry(world, "codex")["priceMultiplier"] === 1,
      "the background billing result in the cache",
    );
    assert.equal(relay.at("/backend-api/codex/models").length, 0);
  },
);

interface StaleRow {
  readonly label: string;
  readonly ageMs: number | null;
}

const STALE_ROWS: readonly StaleRow[] = [
  { label: "12 hours old", ageMs: DISCOVERY_TTL_MS },
  { label: "missing a timestamp", ageMs: null },
];

for (const { label, ageMs } of STALE_ROWS)
  scenario(
    `a cache ${label} registers immediately, then refreshes in the background`,
    PACKAGE,
    async (context) => {
      const { server, world } = context;
      const { promise: release, resolve } = Promise.withResolvers<void>();
      const relay = await startRelay(server, {
        manifest: () => ({
          ...json({ models: [ASTRA] }),
          gate: async (): Promise<void> => {
            await release;
          },
        }),
      });
      world.writeAgentFile("sub2api.json", {
        codex: { baseURL: relay.v1, token: "tok", api: CODEX },
      });
      seedDiscovery(world, {
        codex: { baseUrl: relay.v1, api: CODEX, ageMs, models: [SEEDED_MODEL] },
      });
      const client = opened(context);
      assert.notEqual(await listedModel(client, "codex", "cached-old"), undefined);
      await relay.waitFor("/backend-api/codex/models", 1);
      assert.equal(await listedModel(client, "codex", ASTRA_MODEL), undefined);
      resolve();
      await until(
        async () => (await listedModel(client, "codex", ASTRA_MODEL)) !== undefined,
        "the refreshed registration",
      );
      const { fetchedAt } = discoveryEntry(world, "codex");
      assert.ok(typeof fetchedAt === "number" && fetchedAt > Date.now() - 60_000);
    },
  );

scenario("an expired cache survives a failed background refresh", PACKAGE, async (context) => {
  const { server, world } = context;
  const relay = await startRelay(server, { manifest: () => json({ error: "down" }, 503) });
  world.writeAgentFile("sub2api.json", {
    codex: { baseURL: relay.v1, token: "tok", api: CODEX },
  });
  seedDiscovery(world, {
    codex: { baseUrl: relay.v1, api: CODEX, ageMs: DISCOVERY_TTL_MS + 5, models: [SEEDED_MODEL] },
  });
  const before = discoveryEntry(world, "codex")["fetchedAt"];
  const client = opened(context);
  await until(
    () => client.stderr().includes("background model refresh kept the last cached models"),
    "the refresh failure on stderr",
  );
  assert.notEqual(await listedModel(client, "codex", "cached-old"), undefined);
  assert.equal(discoveryEntry(world, "codex")["fetchedAt"], before);
});
