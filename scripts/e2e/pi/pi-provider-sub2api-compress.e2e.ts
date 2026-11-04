// /openai-compress: one request's overrides, what it refuses, and when it is listed.
import assert from "node:assert/strict";

import { extensionCommands } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import { compactionReply, textReply } from "./servers-sub2api-replies.ts";
import {
  CODEX,
  PACKAGE,
  compactionEntries,
  inSequence,
  runCommand,
} from "./pi-provider-sub2api-support.ts";
import {
  COMMAND_MARKER,
  COMPLETED,
  MANIFEST,
  codexRelay,
  compact,
  detailsOf,
  modelOf,
  openClient,
  tierOf,
} from "./pi-provider-sub2api-compaction-support.ts";
import type { RelayEntry } from "./pi-provider-sub2api-compaction-support.ts";

interface CompressRow {
  readonly args: string;
  readonly model: string;
  readonly tier: string;
}

const COMPRESS_ROWS: readonly CompressRow[] = [
  { args: "", model: "gpt-config", tier: "ultrafast" },
  { args: "gpt-command", model: "gpt-command", tier: "ultrafast" },
  { args: "default", model: "gpt-config", tier: "default" },
  { args: "fast", model: "gpt-config", tier: "priority" },
  { args: "ultrafast", model: "gpt-config", tier: "ultrafast" },
  { args: "gpt-command default", model: "gpt-command", tier: "default" },
  { args: "gpt-command fast", model: "gpt-command", tier: "priority" },
  { args: "  gpt-command   ultrafast  ", model: "gpt-command", tier: "ultrafast" },
];

scenario(
  "/openai-compress applies its arguments to one request only and never sends its marker",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context, {
      compress_model: "gpt-config",
      compress_service_tier: "ultrafast",
    });
    const client = openClient(context);
    await inSequence(COMPRESS_ROWS, async ({ args, model, tier }) => {
      await client.prompt(`before ${args}`);
      await runCommand(client, `/openai-compress ${args}`, COMPLETED);
      const request = relay.compactions().at(-1);
      assert.deepEqual([modelOf(request), tierOf(request)], [model, tier], args);
      assert.equal(request?.body.includes(COMMAND_MARKER), false, "the marker must stay local");
      assert.equal(detailsOf(compactionEntries(context.world).at(-1))["model"], "gpt-conv");
    });
    await client.prompt("before an ordinary compaction");
    await compact(client);
    const ordinary = relay.compactions().at(-1);
    assert.deepEqual([modelOf(ordinary), tierOf(ordinary)], ["gpt-config", "ultrafast"]);
  },
);

scenario(
  "/openai-compress with no overrides inherits the current model and session tier",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    await client.prompt("hello");
    await runCommand(client, "/openai-compress", COMPLETED);
    const request = relay.compactions().at(-1);
    assert.deepEqual([modelOf(request), tierOf(request)], ["gpt-conv", "priority"]);
  },
);

scenario(
  "/openai-compress rejects bad arguments, unsupported models, and busy sessions without compacting",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const { world } = context;
    const plain = await startRelay(context.server, { inventory: inventoryOf([{ id: "gpt-5.5" }]) });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "RELAY-TOKEN", api: CODEX },
      plain: { baseURL: plain.v1, token: "PLAIN-TOKEN", api: "openai-responses" },
    });
    const client = openClient(context);
    await inSequence(["gpt-conv invalid", "gpt-conv fast extra", "x".repeat(257)], async (args) => {
      await runCommand(client, `/openai-compress ${args}`, "Usage: /openai-compress");
    });
    await client.send({ type: "set_model", provider: "plain", modelId: "gpt-5.5" });
    await runCommand(client, "/openai-compress", "requires a Sub2API OpenAI Codex model");
    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-conv" });
    assert.equal(relay.compactions().length, 0);

    const { promise: release, resolve } = Promise.withResolvers<void>();
    relay.queueTurns({
      ...textReply("held"),
      gate: async (): Promise<void> => {
        await release;
      },
    });
    const settled = client.next((event) => event["type"] === "agent_settled", "the held turn");
    await client.send({ type: "prompt", message: "held turn" });
    await relay.waitFor("/v1/responses", 1);
    await runCommand(client, "/openai-compress", "Wait for the active request");
    resolve();
    await settled;
    assert.equal(relay.compactions().length, 0);
  },
);

scenario(
  "/openai-compress blocks a duplicate while one runs, and clears after an error",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    const tooSmall = "OpenAI compaction failed";
    await runCommand(client, "/openai-compress gpt-other", tooSmall);
    await runCommand(client, "/openai-compress gpt-other", tooSmall);
    assert.equal(relay.compactions().length, 0, "an empty session has nothing to compact");

    await client.prompt("hello");
    const { promise: release, resolve } = Promise.withResolvers<void>();
    relay.route({
      compaction: () => ({
        ...compactionReply(),
        gate: async (): Promise<void> => {
          await release;
        },
      }),
    });
    const completed = client.next(
      (event) => String(event["message"]).includes(COMPLETED),
      "the running compaction",
    );
    await client.send({ type: "prompt", message: "/openai-compress gpt-other default" });
    await relay.waitFor("/v1/responses", 2);
    await runCommand(client, "/openai-compress gpt-conv fast", "Wait for the active request");
    resolve();
    await completed;
    assert.equal(relay.compactions().length, 1);
    assert.equal(modelOf(relay.compactions().at(0)), "gpt-other");

    await client.prompt("again");
    await runCommand(client, "/openai-compress", COMPLETED);
    assert.equal(relay.compactions().length, 2, "a finished command leaves nothing pending");
  },
);

scenario(
  "a failed /openai-compress cancels instead of falling back with its internal marker",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    relay.route({ compaction: () => json({ error: "unsupported" }, 404) });
    const client = openClient(context);
    await client.prompt("hello");
    await runCommand(client, "/openai-compress", "Codex native compaction stopped");
    assert.equal(relay.summaries().length, 0, "no textual summary may run");
    assert.ok(
      !relay.requests.some((request) => request.body.includes(COMMAND_MARKER)),
      "the marker must never reach a provider",
    );
    assert.deepEqual(compactionEntries(context.world), []);
  },
);

interface ListingRow {
  readonly entry: RelayEntry;
  readonly inventory: readonly unknown[];
  readonly listed: boolean;
}

const LISTING_ROWS: readonly ListingRow[] = [
  { entry: { api: CODEX }, inventory: [], listed: true },
  { entry: {}, inventory: [{ id: "gpt-conv" }], listed: true },
  { entry: { api: "openai-responses" }, inventory: [{ id: "gpt-conv" }], listed: false },
  { entry: {}, inventory: [{ id: "claude-only" }], listed: false },
];

scenario(
  "/openai-compress is listed only for native Codex models",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, { manifest: MANIFEST });
    const seen = await inSequence(LISTING_ROWS, async ({ entry, inventory }) => {
      relay.route({ inventory: inventoryOf(inventory) });
      world.writeAgentFile("sub2api-models.json", { version: 1, providers: {} });
      world.writeAgentFile("sub2api.json", {
        relay: { baseURL: relay.v1, token: "tok", ...entry },
      });
      const client = rpc(["--session-dir", world.sessionDir]);
      const commands = await client.send({ type: "get_commands" });
      await client.close();
      return extensionCommands(commands).includes("openai-compress");
    });
    assert.deepEqual(
      seen,
      LISTING_ROWS.map(({ listed }) => listed),
    );
  },
);
