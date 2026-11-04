// Limits and reasoning a relay supplies. Online because discovery must reach the relay,
// so every model ID here is one no live catalog has an opinion on.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import { billingReply } from "./servers-sub2api-replies.ts";
import {
  CODEX,
  PACKAGE,
  discoveryEntry,
  mustFindModel,
  listedModel,
} from "./pi-provider-sub2api-support.ts";
import {
  ANTHROPIC,
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  RESPONSES,
  limitsOf,
  listAll,
} from "./pi-provider-sub2api-catalog-support.ts";

const opened = (context: Scenario): RpcClient =>
  context.rpc(["--session-dir", context.world.sessionDir]);

scenario(
  "relay limits win in alias order, and invalid values never reach Pi",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, {
      inventory: inventoryOf([
        { id: "claude-e2e-alias", max_input_tokens: 300_000, max_tokens: 32_000 },
        { id: "claude-e2e-order", context_window: 400_000, max_input_tokens: 900_000 },
        { id: "claude-e2e-string", max_input_tokens: "500000" },
        { id: "claude-e2e-small", max_input_tokens: 4096, max_tokens: 8192 },
        ...[null, 0, -1, 0.5, 99_999_999, "invalid", true].map((value, index) => ({
          id: `claude-e2e-invalid-${String(index)}`,
          max_input_tokens: value,
        })),
      ]),
    });
    world.writeAgentFile("sub2api.json", {
      claude: { baseURL: relay.v1, token: "tok", api: ANTHROPIC },
    });
    const models = await listAll(opened(context));
    const limits = (id: string): readonly unknown[] =>
      limitsOf(mustFindModel(models, "claude", id));
    assert.deepEqual(limits("claude-e2e-alias"), [300_000, 32_000]);
    assert.deepEqual(limits("claude-e2e-order"), [400_000, DEFAULT_OUTPUT]);
    assert.deepEqual(limits("claude-e2e-string"), [500_000, DEFAULT_OUTPUT]);
    assert.deepEqual(limits("claude-e2e-small"), [4096, 4096]);
    for (const index of [0, 1, 2, 3, 4, 5, 6])
      assert.deepEqual(
        limits(`claude-e2e-invalid-${String(index)}`),
        [DEFAULT_CONTEXT, DEFAULT_OUTPUT],
        String(index),
      );
    assert.equal(relay.at("/backend-api/codex/models").length, 0, "Claude never asks the manifest");
  },
);

interface AutoInventoryRow {
  readonly id: string;
}

const AUTO_INVENTORY: readonly (AutoInventoryRow & Readonly<Record<string, unknown>>)[] = [
  { id: "gpt-5.6" },
  { id: "codex-e2e-review" },
  { id: "codex-e2e-output" },
  { id: "codex-e2e-cross", context_window: 100_000, max_tokens: 150_000 },
  { id: "gpt-5.6-e2e-terra", context_window: 260_000, max_tokens: 64_000 },
  {
    id: "grok-e2e-later-aliases",
    display_name: "Later Aliases",
    context_window: 0,
    max_context_tokens: 122_000,
    max_tokens: "",
    max_output_tokens: 12_000,
  },
  { id: "gpt-image-e2e" },
];

const AUTO_MANIFEST = [
  { slug: "gpt-5.6", max_tokens: 0, supported_reasoning_levels: ["unknown"] },
  {
    slug: "gpt-5.6-sol",
    context_window: 272_000,
    max_output_tokens: 96_000,
    supported_reasoning_levels: [
      { effort: " low " },
      { effort: "medium" },
      { effort: "high" },
      { effort: "xhigh" },
      { effort: "max" },
      { effort: "ultra" },
      { effort: "ULTRA" },
    ],
  },
  { slug: "codex-e2e-review", context_window: 272_000 },
  { slug: "codex-e2e-output", context_window: 100_000, max_tokens: 0, max_output_tokens: 50_000 },
  { slug: "codex-e2e-cross", context_window: 100_000, max_output_tokens: 50_000 },
  { slug: "gpt-5.6-e2e-terra", context_window: 272_000 },
  { slug: "manifest-only" },
];

scenario(
  "an automatic relay's inventory stays authoritative while the manifest fills what it omits",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, {
      inventory: inventoryOf(AUTO_INVENTORY),
      manifest: manifestOf(AUTO_MANIFEST),
      billing: () => billingReply(0.01, 2),
    });
    world.writeAgentFile("sub2api.json", { auto: { baseURL: relay.v1, token: "tok" } });
    const models = await listAll(opened(context));
    const auto = models.filter((model) => model["provider"] === "auto");
    assert.deepEqual(
      auto.map((model) => model["id"]),
      AUTO_INVENTORY.map((model: AutoInventoryRow) => model.id).filter(
        (id) => id !== "gpt-image-e2e",
      ),
    );
    const limits = (id: string): readonly unknown[] => limitsOf(mustFindModel(auto, "auto", id));
    assert.deepEqual(limits("gpt-5.6"), [272_000, 96_000]);
    assert.deepEqual(limits("codex-e2e-review"), [272_000, DEFAULT_OUTPUT]);
    assert.deepEqual(limits("codex-e2e-output"), [100_000, 50_000]);
    assert.deepEqual(limits("codex-e2e-cross"), [100_000, 50_000]);
    assert.deepEqual(limits("gpt-5.6-e2e-terra"), [260_000, 64_000]);
    assert.deepEqual(limits("grok-e2e-later-aliases"), [122_000, 12_000]);
    assert.equal(mustFindModel(auto, "auto", "grok-e2e-later-aliases")["name"], "Later Aliases");
    const sol = mustFindModel(auto, "auto", "gpt-5.6");
    assert.equal(sol["api"], CODEX);
    const levels = sol["thinkingLevelMap"];
    assert.ok(isRecord(levels));
    assert.equal(levels["low"], "low");
    assert.equal(levels["max"], "max", "max must not silently send ultra");
    assert.equal(
      discoveryEntry(world, "auto")["priceMultiplier"],
      undefined,
      "an unknown billing schema version is not a rate",
    );
  },
);

const GPT6_LEVELS = {
  minimal: "low",
  low: "low",
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
};

scenario(
  "GPT-6 names reason under every OpenAI API, with or without a manifest",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const withManifest = {
      inventory: inventoryOf([
        { id: "gpt-6-astra", context_window: 272_000, max_output_tokens: 64_000 },
      ]),
      manifest: manifestOf([
        {
          slug: "gpt-6-astra",
          supported_reasoning_levels: ["low", "high", "max", "ultra"].map((effort) => ({ effort })),
        },
      ]),
    };
    const auto = await startRelay(server, withManifest);
    const responses = await startRelay(server, withManifest);
    const completions = await startRelay(server, withManifest);
    const bare = await startRelay(server, {
      inventory: inventoryOf([{ id: "gpt-6" }, { id: "gpt-6-astra" }, { id: "GPT-6-ASTRA" }]),
    });
    world.writeAgentFile("sub2api.json", {
      auto: { baseURL: auto.v1, token: "tok" },
      responses: { baseURL: responses.v1, token: "tok", api: RESPONSES },
      completions: { baseURL: completions.v1, token: "tok", api: "openai-completions" },
      bare: { baseURL: bare.v1, token: "tok" },
    });
    const models = await listAll(opened(context));
    const rows = [
      ["auto", CODEX, "none"],
      ["responses", RESPONSES, null],
      ["completions", "openai-completions", null],
    ] as const;
    for (const [provider, api, off] of rows) {
      const model = mustFindModel(models, provider, "gpt-6-astra");
      assert.equal(model["api"], api, provider);
      assert.equal(model["reasoning"], true, provider);
      assert.deepEqual(limitsOf(model), [272_000, 64_000], provider);
      assert.deepEqual(model["thinkingLevelMap"], { off, ...GPT6_LEVELS }, provider);
    }
    for (const id of ["gpt-6", "gpt-6-astra", "GPT-6-ASTRA"]) {
      const model = mustFindModel(models, "bare", id);
      assert.equal(model["api"], CODEX, id);
      assert.equal(model["reasoning"], true, id);
      assert.deepEqual(
        model["thinkingLevelMap"],
        { off: "none", minimal: "low", xhigh: "xhigh" },
        id,
      );
    }
  },
);

scenario(
  "manifest efforts decide reasoning, and unsafe manifest entries never register",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, {
      manifest: manifestOf([
        {
          slug: "gpt-5-e2e-empty",
          supported_reasoning_levels: [],
          input_modalities: ["text", "image", "audio", "image"],
        },
        { slug: "gpt-5-e2e-none", supported_reasoning_levels: ["none"] },
        { slug: "gpt-5-e2e-absent" },
        null,
        {},
        { slug: " bad-id" },
        { slug: "bad\nmodel" },
        { slug: "x".repeat(257) },
        { slug: "gpt-6-e2e-clean", display_name: "\u001B[31mAstra\n\u001B[0m" },
        { slug: "gpt-6-e2e-clean", display_name: "Duplicate" },
        { slug: "gpt-image-e2e" },
      ]),
    });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: relay.v1, token: "tok", api: CODEX },
    });
    const models = await listAll(opened(context));
    const codex = models.filter((model) => model["provider"] === "codex");
    assert.deepEqual(
      codex.map((model) => model["id"]),
      ["gpt-5-e2e-empty", "gpt-5-e2e-none", "gpt-5-e2e-absent", "gpt-6-e2e-clean"],
    );
    for (const id of ["gpt-5-e2e-empty", "gpt-5-e2e-none", "gpt-5-e2e-absent"]) {
      const model = mustFindModel(codex, "codex", id);
      assert.equal(model["reasoning"], false, id);
      assert.equal(model["thinkingLevelMap"], undefined, id);
    }
    assert.deepEqual(mustFindModel(codex, "codex", "gpt-5-e2e-empty")["input"], ["text", "image"]);
    assert.equal(mustFindModel(codex, "codex", "gpt-6-e2e-clean")["name"], "Astra");
    assert.deepEqual(mustFindModel(codex, "codex", "gpt-6-e2e-clean")["input"], ["text"]);
  },
);

scenario(
  "a missing optional manifest keeps an automatic relay's models and logs nothing",
  PACKAGE,
  async (context) => {
    const { server, world } = context;
    const relay = await startRelay(server, { inventory: inventoryOf([{ id: "gpt-5.5" }]) });
    world.writeAgentFile("sub2api.json", { auto: { baseURL: relay.v1, token: "tok" } });
    const client = opened(context);
    assert.notEqual(await listedModel(client, "auto", "gpt-5.5"), undefined);
    await client.close();
    assert.equal(relay.at("/backend-api/codex/models").length, 1);
    assert.ok(!client.stderr().includes("[sub2api"), client.stderr());
  },
);
