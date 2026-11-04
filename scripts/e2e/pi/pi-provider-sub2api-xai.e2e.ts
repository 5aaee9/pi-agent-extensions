// xAI entries from the outside, on metadata the relay supplies: inventory, separation
// between same-host entries, and defaults for unknown IDs.
import assert from "node:assert/strict";

import type { JsonRecord } from "../../release/json.ts";
import { modelsOf } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { headerOf, inventoryOf, startRelay } from "./servers-sub2api.ts";
import type { Route } from "./servers-sub2api.ts";
import { billingReply } from "./servers-sub2api-replies.ts";
import { PACKAGE, discoveryEntry } from "./pi-provider-sub2api-support.ts";
import { LOW_TO_XHIGH, openWith, xaiRelay } from "./pi-provider-sub2api-xai-support.ts";

const idsAndNames = (models: readonly JsonRecord[], provider: string): readonly unknown[] =>
  models
    .filter((model) => model["provider"] === provider)
    .map((model) => [model["id"], model["name"]]);

scenario(
  "an xAI entry registers exact chat IDs and leaves out Grok media generators",
  PACKAGE,
  async (context) => {
    await xaiRelay(context, [
      { id: "grok-e2e", object: "model", type: "model", display_name: "Grok E2E" },
      { id: "grok-e2e", display_name: "Duplicate" },
      { id: " grok-padded" },
      { id: "" },
      { id: 42 },
      "not-an-object",
      { id: "gpt-*", display_name: "gpt-*" },
      { id: "composer-2.5", display_name: "composer\u001B[31m-2.5" },
      { id: "xai/grok-e2e" },
      { id: "imagine-v2" },
      { id: "grok-imagine" },
      { id: "grok-imagine-1" },
      { id: "grok-imagine-edit" },
      { id: "grok-video-1.5" },
      { id: "grok-imagine-image-quality", type: "model" },
      { id: "grok-imagine-video-1.5-preview" },
      { id: "xai/grok-imagine-image" },
      { id: "X-AI/Grok-Imagine-Video" },
      { id: "grok/imagine" },
      { id: "grok-imagination-text" },
    ]);
    const models = modelsOf(await openWith(context).send({ type: "get_available_models" }));
    assert.deepEqual(idsAndNames(models, "grok"), [
      ["grok-e2e", "Grok E2E"],
      ["gpt-*", "gpt-*"],
      ["composer-2.5", "composer-2.5"],
      ["xai/grok-e2e", "xai/grok-e2e"],
      ["grok-imagination-text", "grok-imagination-text"],
    ]);
  },
);

const byBearer =
  (routes: Readonly<Record<string, Reply>>, fallback: Reply): Route =>
  (request) =>
    routes[String(headerOf(request, "authorization"))] ?? fallback;

scenario(
  "same-host entries keep their credentials, rates, and failures apart",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, {
      inventory: byBearer(
        {
          "Bearer sk-grok-a": json({
            data: [{ id: "grok-a-model", reasoningEfforts: LOW_TO_XHIGH }],
          }),
          "Bearer sk-grok-b": json({ data: [{ id: "grok-b-model" }] }),
          "Bearer sk-openai": json({ data: [{ id: "gpt-e2e" }] }),
        },
        json({ error: "unauthorized" }, 401),
      ),
      billing: byBearer(
        { "Bearer sk-grok-a": billingReply(1), "Bearer sk-grok-b": billingReply(0.5) },
        json({ error: "missing" }, 404),
      ),
    });
    world.writeAgentFile("sub2api.json", {
      "grok-a": { baseURL: relay.baseUrl, token: "${E2E_GROK_A}", api: "xai" },
      "grok-b": { baseURL: `${relay.v1}/`, token: "!printf sk-grok-b", api: "xai" },
      "grok-c": { baseURL: relay.baseUrl, token: "sk-grok-c", api: "xai" },
      openai: { baseURL: relay.baseUrl, token: "sk-openai", api: "openai-responses" },
    });
    const client = rpc(["--session-dir", world.sessionDir], { env: { E2E_GROK_A: "sk-grok-a" } });
    const models = modelsOf(await client.send({ type: "get_available_models" }));
    assert.deepEqual(idsAndNames(models, "grok-a"), [["grok-a-model", "grok-a-model"]]);
    assert.deepEqual(idsAndNames(models, "grok-b"), [["grok-b-model", "grok-b-model"]]);
    assert.deepEqual(idsAndNames(models, "grok-c"), []);
    assert.deepEqual(idsAndNames(models, "openai"), [["gpt-e2e", "gpt-e2e"]]);
    assert.ok(client.stderr().includes("[sub2api:grok-c] failed to fetch models"), client.stderr());
    assert.equal(discoveryEntry(world, "grok-a")["priceMultiplier"], 1);
    assert.equal(discoveryEntry(world, "grok-b")["priceMultiplier"], 0.5);

    await client.send({ type: "set_model", provider: "grok-b", modelId: "grok-b-model" });
    await client.prompt("through grok-b");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer sk-grok-b");
    await client.send({ type: "set_model", provider: "grok-a", modelId: "grok-a-model" });
    await client.prompt("through grok-a");
    assert.equal(headerOf(relay.turns().at(-1), "authorization"), "Bearer sk-grok-a");
  },
);

interface BrokenInventory {
  readonly provider: string;
  readonly reply: Reply;
  readonly message: string;
}

const BROKEN_INVENTORIES: readonly BrokenInventory[] = [
  { provider: "http", reply: json({ error: "down" }, 502), message: "HTTP 502" },
  { provider: "malformed", reply: { status: 200, chunks: ["{"] }, message: "JSON" },
  { provider: "nodata", reply: json({ models: [] }), message: "data array" },
  {
    provider: "media",
    reply: json({ data: [{ id: "grok-imagine-image" }, { id: "gpt-image-1" }, { id: "" }] }),
    message: "no valid chat model IDs",
  },
];

scenario(
  "a broken xAI inventory reports its failure and leaves other entries working",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const broken = await Promise.all(
      BROKEN_INVENTORIES.map(async ({ provider, reply }) => {
        const relay = await startRelay(server, { inventory: () => reply });
        return [provider, { baseURL: relay.v1, token: "tok", api: "xai" }] as const;
      }),
    );
    const healthy = await startRelay(server, { inventory: inventoryOf([{ id: "other-e2e" }]) });
    world.writeAgentFile("sub2api.json", {
      ...Object.fromEntries(broken),
      other: { baseURL: healthy.v1, token: "tok", api: "openai-responses" },
    });
    const client = openWith(context);
    const models = modelsOf(await client.send({ type: "get_available_models" }));
    assert.deepEqual(idsAndNames(models, "other"), [["other-e2e", "other-e2e"]]);
    for (const { provider, message } of BROKEN_INVENTORIES) {
      assert.deepEqual(idsAndNames(models, provider), [], provider);
      const line = client
        .stderr()
        .split("\n")
        .findIndex((text) => text.includes(`[sub2api:${provider}] failed to fetch models`));
      assert.ok(line >= 0, provider);
      assert.ok(client.stderr().includes(message), `${provider}: ${message}`);
    }
  },
);

scenario(
  "IDs absent from the catalogs get uniform defaults, with no fuzzy matching of prefixed names",
  PACKAGE,
  async (context) => {
    await xaiRelay(context, [
      { id: "grok-e2e-reasoning" },
      { id: "xai/grok-e2e" },
      { id: "GROK-E2E" },
      { id: "custom-alias", context_window: 8000 },
    ]);
    const models = modelsOf(await openWith(context).send({ type: "get_available_models" }));
    const seen = models
      .filter((model) => model["provider"] === "grok")
      .map((model) => [
        model["id"],
        model["reasoning"],
        model["input"],
        model["contextWindow"],
        model["maxTokens"],
        model["cost"],
        model["thinkingLevelMap"],
      ]);
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const row = (id: string, context_: number, max: number): readonly unknown[] => [
      id,
      false,
      ["text"],
      context_,
      max,
      zero,
      undefined,
    ];
    assert.deepEqual(seen, [
      row("grok-e2e-reasoning", 200_000, 16_384),
      row("xai/grok-e2e", 200_000, 16_384),
      row("GROK-E2E", 200_000, 16_384),
      row("custom-alias", 8000, 8000),
    ]);
  },
);
