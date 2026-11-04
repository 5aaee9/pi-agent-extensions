// Automatic compaction at a threshold, from the outside: the installed package
// summarizes at a turn boundary with the session's options, and what it commits
// is what the next request and the next process see.
import assert from "node:assert/strict";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import type { ChatReply, RecordedRequest } from "./servers.ts";
import { bodyOf, isSummaryRequest, messagesOf, rolesOf } from "./servers.ts";
import { PROBE_ARGS, sessionEntries } from "./world.ts";

const PACKAGES = { packages: ["pi-autocompact"] };
const OVER_LIMIT_TOKENS = 400_000;
const UNDER_LIMIT_TOKENS = 1000;
const SUMMARY = "boundary summary text";
const ANSWER = "final answer";
/** Well above the default `keepRecentTokens`, so older context can be summarized. */
const LARGE_PROMPT = "x ".repeat(100_000);
const TOOL_OUTPUT_CHARS = 8000;
const KEEP_RECENT_TOKENS = 1000;
const PROBE_ENTRY = "boundary-probe";
/** An extension Pi loads before installed packages, proposing an entry at every boundary. */
const PRECEDING_EXTENSION = `export default function (pi) {
  pi.on("turn_end", (event) => ({
    entries: [...event.entries, { type: "custom", customType: "${PROBE_ENTRY}", data: {} }],
  }));
}
`;

const summaries = (requests: readonly RecordedRequest[]): readonly RecordedRequest[] =>
  requests.filter((request) => isSummaryRequest(request));

/** The tool call ids an assistant message asked for, and the id a tool message answers. */
function toolIds(request: RecordedRequest): readonly (readonly [string, readonly string[]])[] {
  const { messages } = bodyOf(request);
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message: unknown) => isRecord(message))
    .map((message: Readonly<Record<string, unknown>>) => {
      const calls: readonly unknown[] = Array.isArray(message["tool_calls"])
        ? message["tool_calls"]
        : [];
      const ids = calls.map((call) => (isRecord(call) ? String(call["id"]) : ""));
      return [
        String(message["role"]),
        message["role"] === "tool" ? [String(message["tool_call_id"])] : ids,
      ];
    });
}

scenario(
  "a boundary summary carries the reasoning effort and output limit of a native one",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    let promptTokens = UNDER_LIMIT_TOKENS;
    const server = await probeServer(
      (request): ChatReply => (isSummaryRequest(request) ? { text: SUMMARY } : { promptTokens }),
      { reasoning: true },
    );
    const client = rpc([
      "--session",
      join(world.root, "options.jsonl"),
      "--thinking",
      "high",
      ...PROBE_ARGS,
    ]);
    await client.prompt(LARGE_PROMPT);
    await client.prompt(LARGE_PROMPT);
    const compacted = await client.send({ type: "compact" }, 60_000);
    assert.equal(compacted["success"], true, JSON.stringify(compacted));
    const threshold = client.next(
      (event) => event["method"] === "notify" && String(event["message"]).includes("above"),
      "the threshold notice",
    );
    await client.send({ type: "prompt", message: "/autocompact 300k" });
    await threshold;
    promptTokens = OVER_LIMIT_TOKENS;
    await client.prompt(LARGE_PROMPT);
    const [native, boundary] = summaries(server.requests).map((request) => bodyOf(request));
    assert.ok(native !== undefined && boundary !== undefined, "expected both summaries");
    assert.equal(native["reasoning_effort"], "high");
    assert.equal(typeof native["max_completion_tokens"], "number");
    assert.equal(boundary["reasoning_effort"], native["reasoning_effort"]);
    assert.equal(boundary["max_completion_tokens"], native["max_completion_tokens"]);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "a boundary after a tool call keeps the group, the other extension's entry, and no orphan",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.mergeSettings({ compaction: { keepRecentTokens: KEEP_RECENT_TOKENS } });
    const fixture = world.writeAgentFile("fixtures/boundary-probe.ts", PRECEDING_EXTENSION);
    const output = `head -c ${String(TOOL_OUTPUT_CHARS)} /dev/zero | tr '\\0' x`;
    const toolCall = { name: "bash", arguments: JSON.stringify({ command: output }) };
    const replies: ChatReply[] = [{ toolCall, promptTokens: OVER_LIMIT_TOKENS }, { text: ANSWER }];
    const server = await probeServer((request): ChatReply => {
      if (isSummaryRequest(request)) return { text: SUMMARY };
      return replies.shift() ?? {};
    });
    const session = join(world.root, "tools.jsonl");
    const client = rpc(["--session", session, "-e", fixture, ...PROBE_ARGS]);
    const threshold = client.next(
      (event) => event["method"] === "notify" && String(event["message"]).includes("above"),
      "the threshold notice",
    );
    await client.send({ type: "prompt", message: "/autocompact 300k" });
    await threshold;
    await client.prompt("run the tool");

    assert.deepEqual(client.extensionErrors(), []);
    assert.equal(summaries(server.requests).length, 1);
    const next = server.requests.at(-1);
    assert.ok(next !== undefined && !isSummaryRequest(next));
    assert.deepEqual(rolesOf(next), ["user", "assistant", "tool"]);
    assert.ok(
      messagesOf(next)[1]?.text.includes(SUMMARY) ?? false,
      "the summary replaces the rest",
    );
    const [, , call, result] = toolIds(next);
    assert.deepEqual(result?.[1], call?.[1], "the tool result answers the retained call");

    const entries = sessionEntries(session);
    const index = entries.findIndex((entry) => entry["type"] === "compaction");
    const compaction = entries[index];
    assert.ok(compaction !== undefined, "the compaction persists");
    assert.deepEqual(compaction["details"], { source: "pi-autocompact" });
    assert.equal(entries[index - 1]?.["customType"], PROBE_ENTRY);
    const kept = entries.find((entry) => entry["id"] === compaction["firstKeptEntryId"]);
    const keptMessage = kept?.["message"];
    assert.ok(isRecord(keptMessage) && keptMessage["role"] === "assistant", JSON.stringify(kept));
  },
);

scenario(
  "print mode with a saved limit persists the compaction for the next process",
  PACKAGES,
  async ({ world, probeServer, print }) => {
    world.mergeSettings({ piAutocompact: { modelLimits: { "probe/m": 300_000 } } });
    let promptTokens = UNDER_LIMIT_TOKENS;
    const server = await probeServer((request): ChatReply =>
      isSummaryRequest(request) ? { text: SUMMARY } : { text: ANSWER, promptTokens },
    );
    const session = join(world.root, "print.jsonl");
    const args = ["-p", "--session", session, ...PROBE_ARGS];
    await print([...args, `first ${LARGE_PROMPT}`]);
    promptTokens = OVER_LIMIT_TOKENS;
    const crossed = await print([...args, LARGE_PROMPT]);
    assert.equal(crossed.code, 0, crossed.stderr);
    assert.ok(crossed.stdout.includes(ANSWER), crossed.stdout);
    assert.equal(summaries(server.requests).length, 1);
    const compaction = sessionEntries(session).filter((entry) => entry["type"] === "compaction");
    assert.equal(compaction.length, 1);
    assert.deepEqual(compaction[0]?.["details"], { source: "pi-autocompact" });

    promptTokens = UNDER_LIMIT_TOKENS;
    const resumed = await print([...args, "next question"]);
    assert.equal(resumed.code, 0, resumed.stderr);
    const next = server.requests.at(-1);
    assert.ok(next !== undefined);
    const sent = messagesOf(next);
    assert.ok(sent.some((message) => message.text.includes(SUMMARY)));
    assert.ok(!sent.some((message) => message.text.startsWith("first")));
  },
);
