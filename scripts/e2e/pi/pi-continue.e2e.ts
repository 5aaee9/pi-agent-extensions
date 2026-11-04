// `/continue` from the outside: a failed turn resumes in every mode a user or a
// script can run it in, and only once the session is really idle.
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { scenario } from "./scenario.ts";
import type { ChatReply } from "./servers.ts";
import { isChatRequest, isSummaryRequest, messagesOf, rolesOf } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const PACKAGES = { packages: ["pi-continue"] };
const FAILURE: ChatReply = { failure: { status: 400, message: "bad request" } };
const RETRIED = "retried answer";
const LARGE_CONTEXT_TOKENS = 100_000;
const HOLD_MS = 300;

scenario(
  "/continue in print and JSON modes retries the failed turn and exits 0",
  PACKAGES,
  async ({ world, probeServer, print }) => {
    let failing = true;
    const server = await probeServer(() => (failing ? FAILURE : { text: RETRIED }));
    const seed = join(world.root, "seed.jsonl");
    await print(["-p", "--session", seed, ...PROBE_ARGS, "hello"]);
    failing = false;
    const printSession = join(world.root, "print.jsonl");
    const jsonSession = join(world.root, "json.jsonl");
    copyFileSync(seed, printSession);
    copyFileSync(seed, jsonSession);
    const before = server.requests.length;
    const printed = await print(["-p", "--session", printSession, ...PROBE_ARGS, "/continue"]);
    assert.equal(printed.code, 0, printed.stderr);
    assert.ok(printed.stdout.includes(RETRIED), printed.stdout);
    assert.equal(server.requests.length, before + 1);
    const asJson = await print([
      "--mode",
      "json",
      "--session",
      jsonSession,
      ...PROBE_ARGS,
      "/continue",
    ]);
    assert.equal(asJson.code, 0, asJson.stderr);
    assert.ok(asJson.stdout.includes(RETRIED), asJson.stdout);
    assert.equal(server.requests.length, before + 2);
    for (const request of server.requests.slice(before))
      assert.deepEqual(rolesOf(request), ["user"]);
  },
);

scenario(
  "aborting a running tool and continuing retries without losing or repeating the tool's turn",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    let reply: ChatReply = {
      toolCall: { name: "bash", arguments: JSON.stringify({ command: "sleep 30" }) },
    };
    const server = await probeServer(() => reply);
    const client = rpc(["--session-dir", world.sessionDir, ...PROBE_ARGS]);
    const toolStarted = client.next(
      (event) => event["type"] === "tool_execution_start",
      "the tool to start",
    );
    const settled = client.next(
      (event) => event["type"] === "agent_settled",
      "the abort to settle",
    );
    await client.send({ type: "prompt", message: "run the tool" });
    await toolStarted;
    await client.send({ type: "abort" });
    await settled;
    reply = { text: RETRIED };
    await client.prompt("/continue");
    const retry = server.requests.at(-1);
    assert.ok(retry !== undefined);
    const roles = rolesOf(retry);
    assert.deepEqual(roles, ["user", "assistant", "tool"], "retries from the tool result");
    assert.ok(
      !messagesOf(retry).some((message) => message.text.includes("pi-continue")),
      "the hidden retry marker must not reach the model",
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "a repeated /continue after a real failure retries each time from the same user message",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.mergeSettings({ retry: { enabled: false } });
    const failure: ChatReply = { failure: { status: 500, message: "upstream down" } };
    let reply = failure;
    const server = await probeServer(() => reply);
    const client = rpc(["--session-dir", world.sessionDir, ...PROBE_ARGS]);
    await client.prompt("original question");
    await client.prompt("/continue");
    reply = { text: RETRIED };
    await client.prompt("/continue");
    const chats = server.requests.filter(isChatRequest);
    assert.equal(chats.length, 3);
    for (const request of chats) assert.deepEqual(rolesOf(request), ["user"]);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "/continue waits out an in-flight idle compaction before retrying",
  { packages: ["pi-continue", "pi-idle-compression"] },
  async ({ world, probeServer, print, rpc }) => {
    world.mergeSettings({ retry: { enabled: false }, piIdleCompression: { idleMinutes: 0.002 } });
    const { promise: release, resolve: releaseSummary } = Promise.withResolvers<void>();
    let failing = false;
    const server = await probeServer((request) => {
      if (isSummaryRequest(request)) return { text: "summary", gate: async () => release };
      if (failing) return { failure: { status: 500, message: "upstream down" } };
      return { text: RETRIED, promptTokens: LARGE_CONTEXT_TOKENS };
    });
    const session = join(world.root, "large.jsonl");
    const args = ["--session", session, ...PROBE_ARGS];
    await print(["-p", ...args, "x ".repeat(LARGE_CONTEXT_TOKENS)]);
    await print(["-p", ...args, "y ".repeat(LARGE_CONTEXT_TOKENS)]);
    failing = true;
    await print(["-p", ...args, "last question"]);
    failing = false;
    const turns = (): number =>
      server.requests.filter((request) => isChatRequest(request) && !isSummaryRequest(request))
        .length;
    const before = turns();
    const client = rpc(args);
    await client.next((event) => event["type"] === "compaction_start", "idle compaction", 20_000);
    const retried = client.prompt("/continue", 60_000);
    await delay(HOLD_MS);
    assert.equal(turns(), before, "no model request may start while compaction is running");
    releaseSummary();
    await retried;
    assert.equal(turns(), before + 1);
    assert.deepEqual(client.extensionErrors(), []);
  },
);
