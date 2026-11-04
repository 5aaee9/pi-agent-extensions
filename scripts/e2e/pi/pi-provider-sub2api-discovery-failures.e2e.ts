// Broken or oversized discovery responses leave a relay with no models, never with a
// guessed inventory, and other relays keep working.
import assert from "node:assert/strict";

import { modelKeys } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { NOT_FOUND } from "./servers-sub2api-replies.ts";
import { CODEX, PACKAGE, listedModel } from "./pi-provider-sub2api-support.ts";
import { opened } from "./pi-provider-sub2api-catalog-support.ts";

interface NamedRelay {
  readonly provider: string;
  readonly relay: Relay;
}

interface ManifestFailureRow {
  readonly provider: string;
  readonly reply: () => Reply;
  readonly logs: boolean;
}

const oversizedManifest = (): Reply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  chunks: ['{"models":[],"padding":"', "x".repeat(1024 * 1024), '"}'],
});

const MANIFEST_FAILURES: readonly ManifestFailureRow[] = [
  { provider: "unavailable", reply: NOT_FOUND, logs: true },
  {
    provider: "invalid-json",
    reply: () => ({ status: 200, chunks: ["{"] }),
    logs: true,
  },
  { provider: "no-array", reply: () => json({ data: [] }), logs: true },
  { provider: "oversized", reply: oversizedManifest, logs: true },
  {
    provider: "redirected",
    reply: () => ({ status: 302, headers: { location: "/v1/models" } }),
    logs: true,
  },
  { provider: "empty", reply: () => json({ models: [] }), logs: false },
];

scenario(
  "a broken Codex manifest registers nothing and never falls back to /v1/models",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relays = await Promise.all(
      MANIFEST_FAILURES.map(async ({ provider, reply }): Promise<NamedRelay> => {
        const relay = await startRelay(server, {
          manifest: reply,
          inventory: inventoryOf([{ id: "inventory-only" }]),
        });
        return { provider, relay };
      }),
    );
    world.writeAgentFile(
      "sub2api.json",
      Object.fromEntries(
        relays.map((item) => [item.provider, { baseURL: item.relay.v1, token: "tok", api: CODEX }]),
      ),
    );
    const client = opened(context);
    const keys = modelKeys(await client.send({ type: "get_available_models" }));
    await client.close();
    for (const item of relays) {
      const { provider, relay } = item;
      assert.deepEqual(
        keys.filter((key) => key.startsWith(`${provider}/`)),
        [],
        provider,
      );
      assert.equal(relay.at("/v1/models").length, 0, provider);
    }
    for (const { provider, logs } of MANIFEST_FAILURES)
      assert.equal(client.stderr().includes(`[sub2api:${provider}]`), logs, provider);
  },
);

scenario(
  "a response over one MiB without a declared length is cut off, leaving other relays working",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const huge = await startRelay(server, {
      inventory: () => ({
        status: 200,
        chunks: ['{"data":[{"id":"gpt-e2e-huge"}],"padding":"', "x".repeat(1024 * 1024), '"}'],
      }),
    });
    const healthy = await startRelay(server, { inventory: inventoryOf([{ id: "gpt-e2e-ok" }]) });
    world.writeAgentFile("sub2api.json", {
      huge: { baseURL: huge.v1, token: "tok", api: "openai-responses" },
      healthy: { baseURL: healthy.v1, token: "tok", api: "openai-responses" },
    });
    const client = opened(context);
    assert.equal(await listedModel(client, "huge", "gpt-e2e-huge"), undefined);
    assert.notEqual(await listedModel(client, "healthy", "gpt-e2e-ok"), undefined);
  },
);
