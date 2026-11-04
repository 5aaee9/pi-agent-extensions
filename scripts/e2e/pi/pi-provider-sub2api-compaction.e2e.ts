// Native compaction in the installed shape: the command is listed, a checkpoint
// persists, and the next request replays the opaque item instead of a summary.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import { extensionCommands } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { headerOf } from "./servers-sub2api.ts";
import { compactionReply } from "./servers-sub2api-replies.ts";
import { PACKAGE, compactionEntries, inputOf } from "./pi-provider-sub2api-support.ts";
import {
  MARKER_SUMMARY,
  codexRelay,
  compact,
  detailsOf,
  modelOf,
  openClient,
  typesIn,
  windowOf,
} from "./pi-provider-sub2api-compaction-support.ts";

scenario(
  "an installed relay lists /openai-compress, persists a checkpoint, and replays it on the next request",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    const commands = await client.send({ type: "get_commands" });
    assert.ok(extensionCommands(commands).includes("openai-compress"));
    await client.prompt("Remember BLUE-42.");
    await compact(client);

    const request = relay.compactions().at(0);
    assert.equal(headerOf(request, "authorization"), "Bearer RELAY-TOKEN");
    assert.equal(headerOf(request, "x-codex-beta-features"), "remote_compaction_v2");
    assert.equal(headerOf(request, "chatgpt-account-id"), undefined);
    assert.ok(JSON.stringify(inputOf(request)).includes("BLUE-42"));
    const entry = compactionEntries(context.world).at(-1);
    assert.equal(entry?.["summary"], MARKER_SUMMARY);
    assert.equal(detailsOf(entry)["version"], 2);
    assert.equal(detailsOf(entry)["model"], "gpt-conv");
    assert.deepEqual(windowOf(entry).at(-1), {
      id: null,
      type: "compaction",
      encrypted_content: "OPAQUE-1",
    });

    await client.prompt("And now?");
    const replay = relay.turns().at(-1);
    const sent = JSON.stringify(inputOf(replay));
    assert.equal(typesIn(replay, "compaction").at(0)?.["encrypted_content"], "OPAQUE-1");
    assert.ok(!sent.includes(MARKER_SUMMARY), "the summary marker must not replay");
    assert.ok(sent.includes("And now?"));
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "repeated compaction feeds the native window forward, including the compaction_summary item",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    relay.route({
      compaction: () =>
        compactionReply({
          itemType: "compaction_summary",
          opaque: `OPAQUE-${String(relay.compactions().length)}`,
        }),
    });
    const client = openClient(context);
    await client.prompt("Remember BLUE-42.");
    await compact(client);
    await client.prompt("New fact GREEN-7.");
    const replay = relay.turns().at(-1);
    assert.equal(typesIn(replay, "compaction_summary").at(0)?.["encrypted_content"], "OPAQUE-1");

    await compact(client);
    const second = relay.compactions().at(-1);
    assert.deepEqual(
      typesIn(second, "compaction_summary").map((item) => item["encrypted_content"]),
      ["OPAQUE-1"],
      "the previous window is compacted once, not nested",
    );
    assert.ok(JSON.stringify(inputOf(second)).includes("GREEN-7"));
    assert.ok(!JSON.stringify(inputOf(second)).includes(MARKER_SUMMARY));
    assert.deepEqual(inputOf(second).at(-1), { type: "compaction_trigger" });

    await client.prompt("Third turn.");
    assert.deepEqual(
      typesIn(relay.turns().at(-1), "compaction_summary").map((item) => item["encrypted_content"]),
      ["OPAQUE-2"],
    );
  },
);

scenario(
  "a version 1 checkpoint from an older session replays and upgrades, keeping the conversation model",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context, { compress_model: "gpt-other" });
    const session = join(context.world.sessionDir, "older.jsonl");
    const args = ["--session", session, "--provider", "relay", "--model", "gpt-conv", "--approve"];
    const first = context.rpc(args);
    await first.prompt("Remember BLUE-42.");
    await compact(first);
    await first.close();
    const downgraded = readFileSync(session, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const entry: unknown = JSON.parse(line);
        if (!isRecord(entry) || entry["type"] !== "compaction") return line;
        const details = {
          ...detailsOf(entry),
          version: 1,
          compactedWindow: windowOf(entry).slice(-1),
        };
        return JSON.stringify({ ...entry, details });
      });
    writeFileSync(session, `${downgraded.join("\n")}\n`);

    const resumed = context.rpc(args);
    await resumed.prompt("New fact GREEN-7.");
    const replayed = typesIn(relay.turns().at(-1), "compaction");
    assert.equal(replayed.at(0)?.["encrypted_content"], "OPAQUE-1");
    await compact(resumed);
    const second = relay.compactions().at(-1);
    assert.equal(modelOf(second), "gpt-other");
    assert.equal(typesIn(second, "compaction").at(0)?.["encrypted_content"], "OPAQUE-1");
    const entry = compactionEntries(context.world).at(-1);
    assert.equal(detailsOf(entry)["version"], 2);
    assert.equal(detailsOf(entry)["model"], "gpt-conv");
  },
);

scenario(
  "a checkpoint keeps the newest messages within the replay budget",
  PACKAGE,
  async (context) => {
    await codexRelay(context);
    const client = openClient(context);
    await client.prompt(`OLD-OVERSIZED-${"x".repeat(300_000)}`);
    await client.prompt("RECENT-KEPT-42");
    await compact(client);
    const window = JSON.stringify(windowOf(compactionEntries(context.world).at(-1)));
    assert.ok(window.includes("RECENT-KEPT-42"));
    assert.ok(!window.includes("OLD-OVERSIZED"));
  },
);
