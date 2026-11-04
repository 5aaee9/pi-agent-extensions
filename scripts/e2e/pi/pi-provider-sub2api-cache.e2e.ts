// Relay discovery across processes: what a second start reuses, and when the cache
// is not to be trusted.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import {
  CODEX,
  PACKAGE,
  discoveryEntry,
  listedModel,
  requireModel,
  runCommand,
} from "./pi-provider-sub2api-support.ts";

const ASTRA = {
  slug: "astra-preview",
  display_name: "Astra Preview",
  context_window: 262_144,
  max_output_tokens: 64_000,
  input_modalities: ["text", "image"],
  supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "ultra" }],
};
const ASTRA_MODEL = "astra-preview";

const opened = ({ rpc, world }: Scenario): RpcClient => rpc(["--session-dir", world.sessionDir]);

async function assertAstra(client: RpcClient): Promise<void> {
  const model = await requireModel(client, "codex", ASTRA_MODEL);
  assert.equal(model["name"], "Astra Preview");
  assert.equal(model["contextWindow"], 262_144);
  assert.equal(model["maxTokens"], 64_000);
  assert.deepEqual(model["input"], ["text", "image"]);
  assert.equal(model["reasoning"], true);
  assert.deepEqual(model["thinkingLevelMap"], {
    off: "none",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "ultra",
  });
}

async function assertEnrichedAndXai(client: RpcClient): Promise<void> {
  const enriched = await requireModel(client, "relay", "gpt-6-e2e-sol");
  assert.equal(enriched["contextWindow"], 200_000);
  assert.equal(enriched["maxTokens"], 32_000);
  const levels = enriched["thinkingLevelMap"];
  assert.ok(isRecord(levels));
  assert.equal(levels["medium"], "medium");
  assert.equal(levels["low"], null);
  const xai = await requireModel(client, "grok", "grok-e2e");
  assert.equal(xai["name"], "Grok Custom");
  assert.equal(xai["contextWindow"], 128_000);
  assert.equal(xai["maxTokens"], 8192);
  assert.deepEqual(xai["input"], ["text"]);
  assert.equal(xai["reasoning"], true);
  const xaiLevels = xai["thinkingLevelMap"];
  assert.ok(isRecord(xaiLevels));
  assert.equal(xaiLevels["high"], "high");
  assert.equal(xaiLevels["medium"], null);
}

scenario(
  "a second process reuses the manifest cache with no discovery or billing, and no secret on disk",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, {
      manifest: manifestOf([ASTRA]),
      inventory: inventoryOf([{ id: "inventory-only" }]),
    });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: relay.v1, token: "sk-cache-secret", api: CODEX },
    });
    const first = opened(context);
    await assertAstra(first);
    await first.close();
    assert.equal(relay.at("/v1/models").length, 0, "the manifest is the sole inventory");
    assert.equal(relay.at("/backend-api/codex/models").length, 1);
    assert.equal(relay.at("/v1/sub2api/billing").length, 1);
    const path = join(world.agentDir, "sub2api-models.json");
    assert.ok(!readFileSync(path, "utf8").includes("sk-cache-secret"));
    assert.equal(statSync(path).mode % 0o1000, 0o600);
    assert.equal(discoveryEntry(world, "codex")["priceMultiplier"], 1, "404 means no contract");

    const second = opened(context);
    await assertAstra(second);
    await second.close();
    assert.equal(relay.at("/backend-api/codex/models").length, 1);
    assert.equal(relay.at("/v1/sub2api/billing").length, 1);
    assert.equal(relay.at("/v1/models").length, 0);
  },
);

scenario(
  "automatic inventory enrichment and xAI reasoning metadata survive a restart",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, {
      inventory: inventoryOf([{ id: "gpt-6-e2e-sol" }]),
      manifest: manifestOf([
        {
          slug: "gpt-6-e2e-sol",
          context_window: 200_000,
          max_output_tokens: 32_000,
          supported_reasoning_levels: ["medium", "high"],
        },
      ]),
    });
    const grok = await startRelay(server, {
      inventory: inventoryOf([
        {
          id: "grok-e2e",
          display_name: "Grok Custom",
          context_window: 128_000,
          max_output_tokens: 8192,
          input_modalities: ["text"],
          supportsReasoningEffort: true,
          reasoningEfforts: [{ value: "high" }, { value: "low" }],
        },
      ]),
    });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok" },
      grok: { baseURL: grok.v1, token: "tok", api: "xai" },
    });
    const first = opened(context);
    await assertEnrichedAndXai(first);
    await first.close();
    const second = opened(context);
    await assertEnrichedAndXai(second);
    await second.close();
    assert.equal(relay.at("/v1/models").length, 1);
    assert.equal(relay.at("/backend-api/codex/models").length, 1);
    assert.equal(grok.at("/v1/models").length, 1);
  },
);

scenario(
  "a failed discovery is not cached, a corrupt cache refetches, and a moved relay ignores its old entry",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, { manifest: () => json({ error: "down" }, 503) });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: relay.v1, token: "tok", api: CODEX },
    });
    const failed = opened(context);
    assert.equal(await listedModel(failed, "codex", ASTRA_MODEL), undefined);
    await failed.close();
    assert.ok(failed.stderr().includes("failed to fetch Codex model manifest"), failed.stderr());
    assert.ok(!existsSync(join(world.agentDir, "sub2api-models.json")));

    relay.route({ manifest: manifestOf([ASTRA]) });
    world.writeAgentFile("sub2api-models.json", "{");
    const corrupt = opened(context);
    assert.notEqual(await listedModel(corrupt, "codex", ASTRA_MODEL), undefined);
    await corrupt.close();
    assert.equal(relay.at("/backend-api/codex/models").length, 2);

    const moved = await startRelay(server, {
      inventory: inventoryOf([{ id: "moved-model", context_window: 1000, max_tokens: 100 }]),
    });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: moved.v1, token: "tok", api: "openai-responses" },
    });
    const movedClient = opened(context);
    const model = await requireModel(movedClient, "codex", "moved-model");
    assert.equal(model["contextWindow"], 1000);
    assert.equal(await listedModel(movedClient, "codex", ASTRA_MODEL), undefined);
  },
);

scenario(
  "/sub2api-refresh forces discovery, and a failed relay keeps its cache while others update",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const codex = await startRelay(server, { manifest: manifestOf([ASTRA]) });
    const other = await startRelay(server, {
      inventory: inventoryOf([{ id: "other-old", context_window: 4000, max_tokens: 400 }]),
    });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: codex.v1, token: "tok", api: CODEX },
      other: { baseURL: other.v1, token: "tok", api: "openai-responses" },
    });
    const client = opened(context);
    codex.route({ manifest: manifestOf([{ ...ASTRA, slug: "forced-preview" }]) });
    const refreshed = await runCommand(client, "/sub2api-refresh", "Refreshed discovered models");
    assert.ok(refreshed.includes("codex (1)"), refreshed);
    assert.notEqual(await listedModel(client, "codex", "forced-preview"), undefined);
    assert.equal(codex.at("/backend-api/codex/models").length, 2, "a fresh cache does not stop it");

    codex.route({ manifest: () => json({ error: "down" }, 503) });
    other.route({
      inventory: inventoryOf([{ id: "other-new", context_window: 4000, max_tokens: 400 }]),
    });
    const notice = await runCommand(client, "/sub2api-refresh", "Kept the last cached models");
    assert.ok(notice.includes("codex: HTTP 503"), notice);
    assert.ok(notice.includes("other (1)"), notice);
    assert.notEqual(await listedModel(client, "codex", "forced-preview"), undefined);
    assert.notEqual(await listedModel(client, "other", "other-new"), undefined);
    const cachedIds = (provider: string): string =>
      JSON.stringify(discoveryEntry(world, provider)["models"]);
    assert.ok(cachedIds("codex").includes("forced-preview"));
    assert.ok(cachedIds("other").includes("other-new"));
  },
);
