// A process killed with a form open: the session entries Pi wrote must be enough
// to reopen that form on the next start, once, and only where a person can answer.
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import {
  ESCAPE,
  FINISHED,
  FORM,
  PACKAGES,
  QUESTION,
  askCall,
  bridgeEvents,
  bridgeExtension,
  sentText,
  sessionEntries,
  submitFirstOption,
} from "./pi-ask-support.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import type { ChatReply, LocalServer } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const REOPENING = "Reopening unanswered ask_user_question form";
const DISMISSED = "use /ask:replay to reopen it";
const READY = "/ commands";
const CALL_ID = "call_e2e";

interface Crashed {
  readonly session: string;
  readonly server: LocalServer;
}

const hasEntry = (session: string, customType: string): boolean =>
  sessionEntries(session).some((entry) => entry["customType"] === customType);

/** Runs until the form is open, then kills the process the way a crash would. */
async function crashWithFormOpen({ world, probeServer, terminal }: Scenario): Promise<Crashed> {
  let reply: ChatReply = askCall(FORM);
  const server = await probeServer(() => {
    const current = reply;
    reply = { text: FINISHED };
    return current;
  });
  const session = join(world.root, "crashed.jsonl");
  const form = terminal(["--session", session, ...PROBE_ARGS, "Ask the questions"]);
  await form.waitForText(QUESTION);
  await form.kill();
  assert.ok(hasEntry(session, "ask:payload"), "the crash leaves the stored form");
  assert.ok(
    !sessionEntries(session).some(
      ({ message }) => isRecord(message) && message["role"] === "toolResult",
    ),
    "the crash leaves the call without a result",
  );
  return { session, server };
}

scenario(
  "a form killed by SIGKILL reopens on restart and its submitted answer reaches the model",
  PACKAGES,
  async (context) => {
    const { session, server } = await crashWithFormOpen(context);
    const bridge = bridgeExtension(context.world.root);
    const resumed = context.terminal(["-e", bridge.path, "--session", session, ...PROBE_ARGS], {
      env: bridge.env,
    });
    await resumed.waitForText(REOPENING);
    await resumed.waitForText(QUESTION);
    await submitFirstOption(resumed);
    assert.ok(hasEntry(session, "ask:pending-dismissed"));
    assert.ok(sentText(server.requests.at(-1), "user").includes("Scope: All packages"));
    const events = bridgeEvents(bridge.log);
    assert.partialDeepStrictEqual(events.find(({ channel }) => channel === "started")?.data, {
      source: "ask:resume",
      toolCallId: CALL_ID,
    });
    assert.partialDeepStrictEqual(events.find(({ channel }) => channel === "completed")?.data, {
      source: "ask:resume",
      toolCallId: CALL_ID,
      result: { cancelled: false, answers: { scope: { values: ["all"] } } },
    });
  },
);

scenario(
  "cancelling a reopened form dismisses it for later starts and for /new",
  PACKAGES,
  async (context) => {
    const { session, server } = await crashWithFormOpen(context);
    const resumed = context.terminal(["--session", session, ...PROBE_ARGS]);
    await resumed.waitForText(QUESTION);
    const beforeCancel = resumed.mark();
    resumed.send(ESCAPE);
    await resumed.waitForText(DISMISSED, { mark: beforeCancel });
    assert.ok(hasEntry(session, "ask:pending-dismissed"));
    await resumed.kill();
    const third = context.terminal(["--session", session, ...PROBE_ARGS]);
    await third.waitForText(READY);
    third.send("hello\r");
    await third.waitForText(FINISHED);
    assert.ok(!third.text().includes(REOPENING), "the third start must not reopen the form");
    assert.ok(!third.text().includes(QUESTION), "the third start must not show the form");
    const beforeNew = third.mark();
    third.send("/new\r");
    await third.waitForText("New session started", { mark: beforeNew });
    third.send("hello again\r");
    await third.waitForText(FINISHED, { mark: beforeNew });
    assert.ok(!third.text().includes(REOPENING), "/new must not reopen the form");
    assert.ok(server.requests.length > 0);
  },
);

scenario("RPC mode leaves a pending form for a terminal to reopen", PACKAGES, async (context) => {
  const { session } = await crashWithFormOpen(context);
  const copy = join(context.world.root, "rpc.jsonl");
  copyFileSync(session, copy);
  const client = context.rpc(["--session", copy, ...PROBE_ARGS]);
  await client.prompt("hello");
  assert.deepEqual(
    client.notifications().filter(({ message }) => message.includes("ask_user_question")),
    [],
  );
  assert.ok(!hasEntry(copy, "ask:pending-dismissed"), "RPC must not dismiss the form");
  assert.deepEqual(client.extensionErrors(), []);
});
