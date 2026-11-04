// Compaction tiers and failures: textual fallback before a checkpoint, cancellation
// after one.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf, json, sse } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { startRelay } from "./servers-sub2api.ts";
import { sseEvent } from "./servers-sub2api-replies.ts";
import {
  CODEX,
  MANUAL_COMPACTION,
  PACKAGE,
  compactionEntries,
  inSequence,
  modelArgs,
  sessionEntries,
} from "./pi-provider-sub2api-support.ts";
import {
  MANIFEST,
  codexRelay,
  compact,
  detailsOf,
  fail,
  modelOf,
  openClient,
  tierOf,
  typesIn,
} from "./pi-provider-sub2api-compaction-support.ts";
import type { RelayEntry } from "./pi-provider-sub2api-compaction-support.ts";

interface TierRow {
  readonly provider: string;
  readonly entry: RelayEntry;
  readonly model: string;
  readonly tier: string | undefined;
}

const TIER_ROWS: readonly TierRow[] = [
  { provider: "bare", entry: {}, model: "gpt-conv", tier: undefined },
  {
    provider: "nulls",
    entry: { compress_service_tier: null, compress_model: null },
    model: "gpt-conv",
    tier: undefined,
  },
  {
    provider: "fast",
    entry: { compress_service_tier: "fast" },
    model: "gpt-conv",
    tier: "priority",
  },
  {
    provider: "ultra",
    entry: { compress_service_tier: "ultrafast", compress_model: "gpt-mini" },
    model: "gpt-mini",
    tier: "ultrafast",
  },
  {
    provider: "conversation",
    entry: {
      compress_model: "gpt-mini",
      requestModes: { serviceTier: "fast", daybreak: "blue" },
      modelRequestModes: {
        "gpt-conv": { serviceTier: "default" },
        "gpt-mini": { serviceTier: "ultrafast" },
      },
    },
    model: "gpt-mini",
    tier: "default",
  },
  {
    provider: "inherited",
    entry: {
      compress_model: "gpt-mini",
      requestModes: { serviceTier: "fast" },
      modelRequestModes: { "gpt-mini": { serviceTier: "ultrafast" } },
    },
    model: "gpt-mini",
    tier: "priority",
  },
];

scenario(
  "compaction resolves its tier from config, then the conversation model, and leaks into no turn",
  PACKAGE,
  async (context) => {
    const relay = await startRelay(context.server, { manifest: MANIFEST });
    const { rpc, world } = context;
    world.mergeSettings(MANUAL_COMPACTION);
    const entries = TIER_ROWS.map(({ provider, entry }) => [
      provider,
      { baseURL: relay.v1, token: "tok", api: CODEX, ...entry },
    ]);
    world.writeAgentFile("sub2api.json", Object.fromEntries(entries));
    const client = rpc(modelArgs(world, TIER_ROWS[0]?.provider ?? "", "gpt-conv"));
    await inSequence(TIER_ROWS, async ({ provider, entry, model, tier }) => {
      await client.send({ type: "new_session" });
      await client.send({ type: "set_model", provider, modelId: "gpt-conv" });
      await client.prompt(`hello ${provider}`);
      await compact(client);
      const request = relay.compactions().at(-1);
      assert.deepEqual([modelOf(request), tierOf(request)], [model, tier], provider);
      assert.equal(bodyOf(request ?? fail())["access_programs"], undefined, provider);
      const expectedTurnTier =
        isRecord(entry["requestModes"]) && entry["modelRequestModes"] !== undefined
          ? tier
          : undefined;
      assert.equal(tierOf(relay.turns().at(-1)), expectedTurnTier, provider);
    });
  },
);

const REJECTED_AFTER_COMPLETED = sse([
  sseEvent({
    type: "response.completed",
    response: { id: "cmp", status: "completed", created_at: 1_800_000_000 },
  }),
  sseEvent({
    type: "response.output_item.done",
    item: { id: null, type: "compaction", encrypted_content: "TOO-LATE" },
  }),
]);

const EMPTY_ITEM = sse([
  sseEvent({
    type: "response.output_item.done",
    item: { type: "compaction", encrypted_content: "" },
  }),
  sseEvent({ type: "response.completed", response: { id: "cmp", status: "completed" } }),
]);

interface FallbackRow {
  readonly name: string;
  readonly reply: Reply;
  readonly notice: string;
}

const FALLBACK_ROWS: readonly FallbackRow[] = [
  { name: "HTTP 503", reply: json({ error: "busy" }, 503), notice: "HTTP 503" },
  {
    name: "top-level SSE error",
    reply: sse([sseEvent({ type: "error", message: "relay exploded" })]),
    notice: "relay exploded",
  },
  { name: "event after completion", reply: REJECTED_AFTER_COMPLETED, notice: "response.completed" },
  { name: "malformed item", reply: EMPTY_ITEM, notice: "exactly one compaction output item" },
  {
    name: "redirect",
    reply: { status: 302, headers: { location: "/v1/elsewhere" } },
    notice: "Codex native compaction unavailable",
  },
];

scenario(
  "the first native failure falls back to Pi's textual compaction without a retry",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await inSequence(FALLBACK_ROWS, async (row) => {
      const { name, reply, notice } = row;
      relay.route({ compaction: () => reply });
      const compactionsBefore = relay.compactions().length;
      const summariesBefore = relay.summaries().length;
      await client.prompt(`before ${name}`);
      const warned = client.next(
        (event) => String(event["message"]).includes(notice),
        `the ${name} notice`,
      );
      await compact(client);
      const warning = await warned;
      assert.equal(warning["notifyType"], "warning", name);
      assert.equal(relay.compactions().length, compactionsBefore + 1, `${name} is not retried`);
      assert.ok(relay.summaries().length > summariesBefore, `${name} falls back`);
      const entry = compactionEntries(context.world).at(-1);
      assert.equal(detailsOf(entry)["kind"], undefined, `${name} persists no native state`);
      assert.ok(String(entry?.["summary"]).includes("textual summary"), name);
    });
    assert.ok(!JSON.stringify(sessionEntries(context.world)).includes("TOO-LATE"));
    assert.deepEqual(relay.at("/v1/elsewhere"), [], "a compaction redirect is not followed");
  },
);

scenario(
  "a failure after a native checkpoint cancels and keeps the only replayable checkpoint",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await client.prompt("one");
    await compact(client);
    await client.prompt("two");
    relay.route({ compaction: () => json({ error: "busy" }, 503) });
    const stopped = client.next(
      (event) => String(event["message"]).includes("Codex native compaction stopped"),
      "the cancellation notice",
    );
    const response = await client.send({ type: "compact" });
    await stopped;
    assert.equal(response["success"], false);
    assert.equal(relay.summaries().length, 0);
    assert.equal(compactionEntries(context.world).length, 1);
    await client.prompt("three");
    assert.equal(typesIn(relay.turns().at(-1), "compaction").length, 1);
  },
);

scenario(
  "a checkpoint for another model is neither compacted nor replayed after a model switch",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await client.prompt("on the first model");
    await compact(client);
    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-other" });
    await client.prompt("on the second model");
    const turn = relay.turns().at(-1);
    assert.equal(modelOf(turn), "gpt-other");
    assert.equal(typesIn(turn, "compaction").length, 0, "opaque state stays with its model");
    const stopped = client.next(
      (event) => String(event["message"]).includes("different model or relay"),
      "the invalid checkpoint notice",
    );
    const response = await client.send({ type: "compact" });
    await stopped;
    assert.equal(response["success"], false);
    assert.equal(relay.compactions().length, 1, "no request may carry the foreign checkpoint");
  },
);
