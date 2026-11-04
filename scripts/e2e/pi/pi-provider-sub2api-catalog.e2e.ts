// Offline: models the relay gives no metadata for follow Pi's built-in catalog, compared
// with the built-in model Pi itself reports.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import {
  CODEX,
  OFFLINE_WORLD,
  mustFindModel,
  seedDiscovery,
} from "./pi-provider-sub2api-support.ts";
import type { SeededRelay } from "./pi-provider-sub2api-support.ts";
import {
  ANTHROPIC,
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  RESPONSES,
  UNROUTABLE,
  builtinWithLargeOutput,
  costOf,
  listAll,
  limitsOf,
  opened,
  scaled,
  sameJson,
} from "./pi-provider-sub2api-catalog-support.ts";

const named = (id: string, extra: JsonRecord = {}): JsonRecord => ({ id, name: id, ...extra });

const entry = (api: string, models: readonly unknown[]): SeededRelay => ({
  baseUrl: UNROUTABLE,
  api,
  models,
});

interface BuiltinIds {
  readonly anthropic: string;
  readonly openai: string;
  readonly xai: string;
}

async function builtinIds(context: Scenario): Promise<BuiltinIds> {
  const client = opened(context);
  const models = await listAll(client);
  await client.close();
  return {
    anthropic: String(builtinWithLargeOutput(models, "anthropic")["id"]),
    openai: String(builtinWithLargeOutput(models, "openai")["id"]),
    xai: String(builtinWithLargeOutput(models, "xai")["id"]),
  };
}

function assertAnthropic(models: readonly JsonRecord[], id: string): void {
  const builtin = mustFindModel(models, "anthropic", id);
  const claude = mustFindModel(models, "claude", id);
  assert.deepEqual(limitsOf(claude), [builtin["contextWindow"], DEFAULT_OUTPUT]);
  assert.notEqual(builtin["maxTokens"], DEFAULT_OUTPUT, "the catalog cap must differ to mean much");
  assert.deepEqual(costOf(claude), costOf(builtin));
  const haiku = mustFindModel(models, "claude", "claude-haiku-4-5-e2e");
  assert.deepEqual(limitsOf(haiku), [DEFAULT_CONTEXT, 8192]);
  const unknown = mustFindModel(models, "claude", "claude-e2e-unknown");
  assert.deepEqual(limitsOf(unknown), [DEFAULT_CONTEXT, DEFAULT_OUTPUT]);
  assert.deepEqual(costOf(unknown), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
}

function assertOpenai(models: readonly JsonRecord[], id: string): void {
  const builtin = mustFindModel(models, "openai", id);
  const plain = mustFindModel(models, "plain", id);
  assert.deepEqual(limitsOf(plain), limitsOf(builtin));
  assert.deepEqual(costOf(plain), costOf(builtin));
  const billed = mustFindModel(models, "billed", id);
  assert.deepEqual(sameJson(costOf(billed)), sameJson(scaled(costOf(builtin), 0.5)));
  assert.deepEqual(limitsOf(mustFindModel(models, "small", id)), [1000, 1000]);
}

function assertXai(models: readonly JsonRecord[], id: string): void {
  const builtin = mustFindModel(models, "xai", id);
  const grok = mustFindModel(models, "grok", id);
  assert.deepEqual(limitsOf(grok), limitsOf(builtin));
  assert.deepEqual(costOf(grok), costOf(builtin));
  assert.deepEqual(grok["input"], builtin["input"]);
  assert.deepEqual(grok["compat"], { supportsLongCacheRetention: false });
}

scenario(
  "offline, models the relay gives no metadata for follow the built-in catalog, except Anthropic's output cap",
  OFFLINE_WORLD,
  async (context) => {
    const { world } = context;
    const relay = { baseURL: UNROUTABLE, token: "tok" };
    world.writeAgentFile("sub2api.json", {
      claude: { ...relay, api: ANTHROPIC },
      plain: { ...relay, api: RESPONSES },
      billed: { ...relay, api: RESPONSES },
      small: { ...relay, api: RESPONSES },
      grok: { ...relay, api: "xai" },
    });
    const ids = await builtinIds(context);
    seedDiscovery(world, {
      claude: entry(ANTHROPIC, [
        named(ids.anthropic),
        named("claude-haiku-4-5-e2e"),
        named("claude-e2e-unknown"),
      ]),
      plain: entry(RESPONSES, [named(ids.openai)]),
      billed: { ...entry(RESPONSES, [named(ids.openai)]), priceMultiplier: 0.5 },
      small: entry(RESPONSES, [named(ids.openai, { contextWindow: 1000 })]),
      grok: { ...entry(RESPONSES, [named(ids.xai)]), xai: true },
    });
    const models = await listAll(opened(context));
    assertAnthropic(models, ids.anthropic);
    assertOpenai(models, ids.openai);
    assertXai(models, ids.xai);
  },
);

scenario(
  "offline, a malformed catalog cache falls back to the built-in catalog and stays as it was",
  OFFLINE_WORLD,
  async (context) => {
    const { world } = context;
    world.writeAgentFile("sub2api.json", {
      plain: { baseURL: UNROUTABLE, token: "tok", api: RESPONSES },
      codex: { baseURL: UNROUTABLE, token: "tok", api: CODEX },
    });
    const { openai } = await builtinIds(context);
    world.writeAgentFile("models-store.json", "{");
    seedDiscovery(world, { plain: entry(RESPONSES, [named(openai)]) });
    const models = await listAll(opened(context));
    const builtin = mustFindModel(models, "openai", openai);
    assert.deepEqual(limitsOf(mustFindModel(models, "plain", openai)), limitsOf(builtin));
    assert.deepEqual(costOf(mustFindModel(models, "plain", openai)), costOf(builtin));
    assert.equal(readFileSync(join(world.agentDir, "models-store.json"), "utf8"), "{");
  },
);
