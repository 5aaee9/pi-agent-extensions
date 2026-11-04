// Idle compaction from the outside, next to `pi-autocompact`: the host does not
// announce boundary compactions (upstream #11706), so only the package's own
// checks keep the timer from warning about, or paying for, a second compaction.
// A pending timer must never hold a print run open either.
import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { ChatReply, LocalServer } from "./servers.ts";
import { isSummaryRequest } from "./servers.ts";
import { PROBE_ARGS, sessionEntries } from "./world.ts";

const PACKAGES = { packages: ["pi-autocompact", "pi-idle-compression"] };
const LIMIT = { piAutocompact: { modelLimits: { "probe/m": 300_000 } } };
const OVER_LIMIT_TOKENS = 400_000;
const UNDER_LIMIT_TOKENS = 1000;
/** 120 ms: the timer fires well inside the window the scenarios watch. */
const QUICK_IDLE = { piIdleCompression: { idleMinutes: 0.002 } };
/** Nothing announces a timer that fired and did nothing, so this is observed by waiting. */
const AFTER_TIMER_MS = 1000;
const PRINT_BOUND_MS = 20_000;
/** Above the default `keepRecentTokens`, so older context can be summarized. */
const LARGE_PROMPT = "x ".repeat(100_000);
const NOT_ARMED = "No idle period armed";
/** Loaded before installed packages: leaves a message right after a boundary compaction. */
const MESSAGE_AFTER_COMPACTION = `export default function (pi) {
  pi.on("agent_before_settle", (event, ctx) => {
    if (ctx.sessionManager.getBranch().at(-1)?.type !== "compaction") return;
    const content = "z ".repeat(100000);
    return {
      entries: [...event.entries, { type: "custom_message", customType: "probe", content, display: false }],
    };
  });
}
`;

const summaryCount = (server: LocalServer): number =>
  server.requests.filter((request) => isSummaryRequest(request)).length;

const compactionCount = (session: string): number =>
  sessionEntries(session).filter((entry) => entry["type"] === "compaction").length;

async function compactionEnded(client: RpcClient): Promise<void> {
  await client.next((event) => event["type"] === "compaction_end", "idle compaction to end");
}

const idleNotices = (client: RpcClient): readonly string[] =>
  client
    .notifications()
    .map((notice) => notice.message)
    .filter((message) => message.startsWith("Idle"));

/** Waits out the timer, then has the package itself report that nothing is pending. */
async function timerSpent(client: RpcClient): Promise<void> {
  await delay(AFTER_TIMER_MS);
  const status = client.next(
    (event) => event["method"] === "notify" && String(event["message"]).includes("compact after"),
    "the idle status",
  );
  await client.send({ type: "prompt", message: "/idle-compression" });
  const notice = await status;
  assert.ok(String(notice["message"]).includes(NOT_ARMED), String(notice["message"]));
}

scenario(
  "the idle timer stays silent after a boundary compaction, and compacts once after later work",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.mergeSettings(LIMIT);
    let promptTokens = UNDER_LIMIT_TOKENS;
    const server = await probeServer((request): ChatReply =>
      isSummaryRequest(request) ? { text: "summary" } : { promptTokens },
    );
    const session = join(world.root, "boundary.jsonl");
    const client = rpc(["--session", session, ...PROBE_ARGS]);
    await client.prompt(LARGE_PROMPT);
    // The idle time is read at each arm: the default holds off until the boundary turn.
    world.mergeSettings(QUICK_IDLE);
    promptTokens = OVER_LIMIT_TOKENS;
    await client.prompt(LARGE_PROMPT);
    assert.equal(summaryCount(server), 1, "the boundary compaction summarized once");
    await timerSpent(client);
    assert.equal(summaryCount(server), 1, "the timer must not summarize a compacted context");
    assert.equal(compactionCount(session), 1);
    assert.deepEqual(idleNotices(client), [], "Pi refuses a repeat, which must not reach the user");

    promptTokens = UNDER_LIMIT_TOKENS;
    const ended = compactionEnded(client);
    await client.prompt(LARGE_PROMPT);
    await ended;
    await timerSpent(client);
    assert.equal(summaryCount(server), 2, "later work earns one idle compaction");
    assert.equal(compactionCount(session), 2);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "the idle timer pays for no second summary while a boundary compaction is unmeasured",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.mergeSettings(LIMIT);
    const fixture = world.writeAgentFile("fixtures/after-compaction.ts", MESSAGE_AFTER_COMPACTION);
    let promptTokens = UNDER_LIMIT_TOKENS;
    const server = await probeServer((request): ChatReply =>
      isSummaryRequest(request) ? { text: "summary" } : { promptTokens },
    );
    const session = join(world.root, "unmeasured.jsonl");
    const client = rpc(["--session", session, "-e", fixture, ...PROBE_ARGS]);
    await client.prompt(LARGE_PROMPT);
    world.mergeSettings(QUICK_IDLE);
    promptTokens = OVER_LIMIT_TOKENS;
    await client.prompt(LARGE_PROMPT);
    assert.equal(sessionEntries(session).at(-1)?.["type"], "custom_message");
    await timerSpent(client);
    assert.equal(summaryCount(server), 1);
    assert.equal(compactionCount(session), 1);
    assert.deepEqual(idleNotices(client), []);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "reopening a conversation arms the timer, which compacts it once",
  PACKAGES,
  async ({ world, probeServer, print, rpc }) => {
    world.mergeSettings(LIMIT);
    const server = await probeServer((request): ChatReply =>
      isSummaryRequest(request) ? { text: "summary" } : { promptTokens: UNDER_LIMIT_TOKENS },
    );
    const session = join(world.root, "reopened.jsonl");
    const args = ["--session", session, ...PROBE_ARGS];
    await print(["-p", ...args, LARGE_PROMPT]);
    await print(["-p", ...args, LARGE_PROMPT]);
    assert.equal(summaryCount(server), 0);
    world.mergeSettings(QUICK_IDLE);

    const client = rpc(args);
    await compactionEnded(client);
    await timerSpent(client);
    assert.equal(summaryCount(server), 1);
    assert.equal(compactionCount(session), 1);
    assert.ok(
      client
        .notifications()
        .some((notice) => notice.message.startsWith("Idle compaction completed")),
      JSON.stringify(client.notifications()),
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "print mode exits promptly with an idle timer armed",
  PACKAGES,
  async ({ world, probeServer, print }) => {
    world.mergeSettings({ ...LIMIT, piIdleCompression: { idleMinutes: 50 } });
    const server = await probeServer();
    const session = join(world.root, "print.jsonl");
    const args = ["-p", "--session", session, ...PROBE_ARGS];
    const fresh = await print([...args, "hello"], { timeoutMs: PRINT_BOUND_MS });
    assert.equal(fresh.timedOut, false, "a timer armed when the turn settled held the process");
    assert.equal(fresh.code, 0, fresh.stderr);
    // A command is not input, so the timer armed on reopening stays armed until exit.
    const reopened = await print([...args, "/idle-compression"], { timeoutMs: PRINT_BOUND_MS });
    assert.equal(reopened.timedOut, false, "a timer armed on reopening held the process");
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(server.requests.length, 1);
  },
);
