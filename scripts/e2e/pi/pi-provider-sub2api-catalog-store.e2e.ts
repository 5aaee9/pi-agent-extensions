// Offline: Pi's cached catalog supplies limits and prices, field by field.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { startRelay } from "./servers-sub2api.ts";
import {
  CODEX,
  MANUAL_COMPACTION,
  OFFLINE_WORLD,
  compactionEntries,
  modelArgs,
  mustFindModel,
  seedDiscovery,
  seedStore,
} from "./pi-provider-sub2api-support.ts";
import {
  ANTHROPIC,
  DEFAULT_OUTPUT,
  RESPONSES,
  UNROUTABLE,
  builtinWithLargeOutput,
  costOf,
  limitsOf,
  listAll,
  opened,
} from "./pi-provider-sub2api-catalog-support.ts";

const storeModel = (provider: string, api: string, fields: JsonRecord): JsonRecord => ({
  name: String(fields["id"]),
  provider,
  api,
  baseUrl: "https://catalog.example",
  reasoning: true,
  input: ["text", "image"],
  ...fields,
});

const STORE_COST = { input: 10, output: 50, cacheRead: 1, cacheWrite: 0 };

const codexEntry = (id: string, maxTokens: number): JsonRecord =>
  storeModel("openai-codex", CODEX, { id, maxTokens, cost: STORE_COST, contextWindow: 272_000 });

function seedCodexAndClaude(context: Scenario, knownOpenai: string, knownAnthropic: string): void {
  seedStore(context.world, {
    "openai-codex": [
      codexEntry("gpt-6-e2e-cached", 128_000),
      codexEntry("gpt-6-e2e-own", 128_000),
      codexEntry("gpt-6-e2e-small", 128_000),
      codexEntry(knownOpenai, 96_000),
    ],
    anthropic: [
      storeModel("anthropic", ANTHROPIC, {
        id: knownAnthropic,
        contextWindow: 600_000,
        maxTokens: 128_000,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      }),
    ],
  });
  const levels = { reasoning: true, input: ["text"], supportedThinkingLevels: ["low", "max"] };
  seedDiscovery(context.world, {
    codex: {
      baseUrl: UNROUTABLE,
      api: CODEX,
      models: [
        { id: "gpt-6-e2e-cached", name: "a", contextWindow: 272_000, ...levels },
        { id: "gpt-6-e2e-own", name: "b", contextWindow: 272_000, maxTokens: 64_000, ...levels },
        { id: "gpt-6-e2e-small", name: "c", contextWindow: 64_000, ...levels },
        { id: knownOpenai, name: "d", contextWindow: 272_000, ...levels },
      ],
    },
    claude: { baseUrl: UNROUTABLE, api: ANTHROPIC, models: [{ id: knownAnthropic, name: "e" }] },
  });
}

scenario(
  "offline, Pi's cached catalog supplies limits and prices, without overriding the relay or Anthropic's cap",
  OFFLINE_WORLD,
  async (context) => {
    const { world } = context;
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: UNROUTABLE, token: "tok", api: CODEX },
      claude: { baseURL: UNROUTABLE, token: "tok", api: ANTHROPIC },
    });
    const probe = opened(context);
    const builtin = await listAll(probe);
    await probe.close();
    const knownOpenai = String(builtinWithLargeOutput(builtin, "openai")["id"]);
    const knownAnthropic = String(builtinWithLargeOutput(builtin, "anthropic")["id"]);
    seedCodexAndClaude(context, knownOpenai, knownAnthropic);
    const storePath = join(world.agentDir, "models-store.json");
    const storeBefore = readFileSync(storePath, "utf8");
    const models = await listAll(opened(context));
    const onCodex = (id: string): JsonRecord => mustFindModel(models, "codex", id);
    assert.deepEqual(limitsOf(onCodex("gpt-6-e2e-cached")), [272_000, 128_000]);
    assert.deepEqual(limitsOf(onCodex("gpt-6-e2e-own")), [272_000, 64_000]);
    assert.deepEqual(limitsOf(onCodex("gpt-6-e2e-small")), [64_000, DEFAULT_OUTPUT]);
    assert.deepEqual(limitsOf(onCodex(knownOpenai)), [272_000, 96_000]);
    assert.deepEqual(costOf(onCodex("gpt-6-e2e-cached")), STORE_COST);
    assert.deepEqual(costOf(onCodex(knownOpenai)), STORE_COST);
    const claude = mustFindModel(models, "claude", knownAnthropic);
    assert.deepEqual(limitsOf(claude), [600_000, DEFAULT_OUTPUT]);
    assert.equal(costOf(claude)["input"], 5);
    assert.equal(readFileSync(storePath, "utf8"), storeBefore);
  },
);

const xaiStore = (fields: JsonRecord): JsonRecord => storeModel("xai", RESPONSES, fields);

const ALL_NULL_LEVELS = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: null,
  xhigh: null,
  max: null,
};

const seededGrokModels = (bundledId: string): readonly unknown[] => [
  { id: "grok-e2e-cached", name: "a", contextWindow: 120_000, remoteMaxTokens: [] },
  { id: bundledId, name: "b", contextWindow: 10_000, remoteMaxTokens: [150_000], input: ["text"] },
  {
    id: "grok-e2e-cache-only",
    name: "c",
    remoteMaxTokens: [],
    xaiReasoning: { supportsReasoningEffort: true },
  },
  { id: "grok-e2e-all-null", name: "d", remoteMaxTokens: [] },
  { id: "grok-e2e-remote", name: "e", contextWindow: 100_000, remoteMaxTokens: [200_000, 32_000] },
];

function seedXai(context: Scenario, bundledId: string): void {
  seedStore(context.world, {
    xai: [
      xaiStore({
        id: "grok-e2e-cached",
        input: ["text"],
        contextWindow: 450_000,
        maxTokens: 64_000,
        cost: { input: 3, output: 9, cacheRead: 0.75, cacheWrite: 0 },
        thinkingLevelMap: { off: "none", minimal: null, low: "low", xhigh: null, max: null },
      }),
      xaiStore({
        id: "grok-e2e-all-null",
        contextWindow: 500_000,
        maxTokens: 500_000,
        cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
        thinkingLevelMap: ALL_NULL_LEVELS,
      }),
      xaiStore({
        id: "grok-e2e-cache-only",
        reasoning: false,
        contextWindow: 300_000,
        maxTokens: 400_000,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
  });
  seedDiscovery(context.world, {
    grok: { baseUrl: UNROUTABLE, api: RESPONSES, xai: true, models: seededGrokModels(bundledId) },
  });
}

function assertCachedLevels(cached: JsonRecord): void {
  assert.deepEqual(limitsOf(cached), [120_000, 64_000]);
  assert.deepEqual(cached["input"], ["text"]);
  assert.equal(costOf(cached)["cacheRead"], 0.75);
  assert.deepEqual(cached["thinkingLevelMap"], {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  });
}

scenario(
  "offline, each xAI field resolves on its own from the relay, cached catalog, built-in catalog, then defaults",
  OFFLINE_WORLD,
  async (context) => {
    const { world } = context;
    world.writeAgentFile("sub2api.json", {
      grok: { baseURL: UNROUTABLE, token: "tok", api: "xai" },
    });
    const probe = opened(context);
    const bundledId = String(builtinWithLargeOutput(await listAll(probe), "xai")["id"]);
    await probe.close();
    seedXai(context, bundledId);
    const models = await listAll(opened(context));
    const grok = (id: string): JsonRecord => mustFindModel(models, "grok", id);
    assertCachedLevels(grok("grok-e2e-cached"));
    assert.deepEqual(limitsOf(grok(bundledId)), [10_000, 10_000]);
    assert.deepEqual(costOf(grok(bundledId)), costOf(mustFindModel(models, "xai", bundledId)));
    assert.deepEqual(limitsOf(grok("grok-e2e-cache-only")), [300_000, DEFAULT_OUTPUT]);
    assert.equal(grok("grok-e2e-cache-only")["reasoning"], true);
    assert.equal(costOf(grok("grok-e2e-cache-only"))["input"], 1);
    const allNull = grok("grok-e2e-all-null");
    assert.equal(allNull["reasoning"], true);
    const levels = allNull["thinkingLevelMap"];
    assert.ok(isRecord(levels));
    assert.ok(!Object.hasOwn(levels, "off"), "an all-null map is an empty bound");
    assert.equal(costOf(allNull)["cacheRead"], 0.3);
    assert.deepEqual(limitsOf(grok("grok-e2e-remote")), [100_000, 32_000]);
  },
);

const priced = (id: string, input: number): JsonRecord =>
  storeModel("openai-codex", CODEX, {
    id,
    contextWindow: 100_000,
    maxTokens: 10_000,
    cost: { input, output: input, cacheRead: 0, cacheWrite: 0 },
  });

const compactionUsage = (context: Scenario): JsonRecord => {
  const usage = compactionEntries(context.world).at(-1)?.["usage"];
  return isRecord(usage) ? usage : assert.fail("the compaction entry has no usage");
};

scenario(
  "offline, compaction bills an override at its own price only when its model is known",
  OFFLINE_WORLD,
  async (context) => {
    const { rpc, server, world } = context;
    const relay = await startRelay(server);
    world.mergeSettings(MANUAL_COMPACTION);
    seedStore(world, {
      "openai-codex": [priced("gpt-6-e2e-conv", 100), priced("gpt-6-e2e-known", 10)],
    });
    const models = [
      { id: "gpt-6-e2e-conv", name: "conv", contextWindow: 100_000, maxTokens: 10_000 },
      { id: "gpt-6-e2e-known", name: "known", contextWindow: 100_000, maxTokens: 10_000 },
    ];
    const entry = { baseURL: relay.v1, token: "tok", api: CODEX };
    world.writeAgentFile("sub2api.json", {
      known: { ...entry, compress_model: "gpt-6-e2e-known" },
      absent: { ...entry, compress_model: "gpt-6-e2e-absent" },
    });
    seedDiscovery(world, {
      known: { baseUrl: relay.v1, api: CODEX, models },
      absent: { baseUrl: relay.v1, api: CODEX, models },
    });
    const client = rpc(modelArgs(world, "known", "gpt-6-e2e-conv"));
    await client.prompt("known override");
    await client.send({ type: "compact" });
    const known = compactionUsage(context);
    assert.equal(known["input"], 80);
    assert.ok(Math.abs(Number(costOf(known)["input"]) - (80 * 10) / 1_000_000) < 1e-12);

    await client.send({ type: "new_session" });
    await client.send({ type: "set_model", provider: "absent", modelId: "gpt-6-e2e-conv" });
    await client.prompt("unknown override");
    await client.send({ type: "compact" });
    assert.equal(costOf(compactionUsage(context))["total"], 0);
  },
);
