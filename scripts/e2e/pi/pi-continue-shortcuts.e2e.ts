// The `/continue` shortcuts in a real terminal, because no RPC request can press a key.
import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { scenario } from "./scenario.ts";
import type { ChatReply, RecordedRequest } from "./servers.ts";
import { rolesOf } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const PACKAGES = { packages: ["pi-continue"] };
const FAILURE: ChatReply = { failure: { status: 400, message: "bad request" } };
const RETRIED = "retried answer";
const HOLD_MS = 300;
const F5 = "\u001B[15~";
const ALT_R = "\u001Br";
const ESCAPE = "\u001B";
const SEEDED = "seeded question";
const BUSY_NOTICE = "Cannot continue while the agent is busy";

function lastRoles(requests: readonly RecordedRequest[]): readonly string[] {
  const last = requests.at(-1);
  assert.ok(last !== undefined);
  return rolesOf(last);
}

// F5 and Alt+R are omp's `app.retry` keys. They must retry the failed turn exactly like the command.
for (const [key, label] of [
  [F5, "F5"],
  [ALT_R, "Alt+R"],
] as const) {
  scenario(
    `${label} retries the failed turn from a real terminal`,
    PACKAGES,
    async ({ world, probeServer, print, terminal }) => {
      let failing = true;
      const server = await probeServer(() => (failing ? FAILURE : { text: RETRIED }));
      const session = join(world.root, "shortcut.jsonl");
      const args = ["--session", session, ...PROBE_ARGS];
      await print(["-p", ...args, SEEDED]);
      failing = false;
      const screen = terminal(args);
      // The seeded turn renders once the editor is ready to take the key.
      await screen.waitForText(SEEDED);
      const before = server.requests.length;
      screen.send(key);
      await screen.waitForText(RETRIED);
      assert.equal(server.requests.length, before + 1);
      assert.deepEqual(lastRoles(server.requests), ["user"]);
      // The retried turn completed, so the same key must now start nothing.
      const afterRetry = screen.mark();
      screen.send(key);
      await screen.waitForText("No interrupted or failed turn to continue", { mark: afterRetry });
      assert.equal(server.requests.length, before + 1);
    },
  );
}

// A key left waiting behind a running turn would treat the user's Esc as a turn to retry.
scenario(
  "a shortcut during a running turn does nothing, so interrupting that turn stays interrupted",
  PACKAGES,
  async ({ probeServer, terminal }) => {
    const { promise: held, resolve: holdStarted } = Promise.withResolvers<void>();
    const { promise: release, resolve: releaseHeld } = Promise.withResolvers<void>();
    let reply: ChatReply = {
      text: "held answer",
      gate: async (): Promise<void> => {
        holdStarted();
        await release;
      },
    };
    const server = await probeServer(() => reply);
    const screen = terminal([...PROBE_ARGS, "hello"]);
    await held;
    const pressed = screen.mark();
    screen.send(F5);
    await screen.waitForText(BUSY_NOTICE, { mark: pressed });
    reply = { text: RETRIED };
    screen.send(ESCAPE);
    await screen.waitForText("Operation aborted", { mark: pressed });
    releaseHeld();
    await delay(HOLD_MS);
    assert.equal(server.requests.length, 1, "Esc must not restart the turn");
    screen.send(F5);
    await screen.waitForText(RETRIED);
    assert.equal(server.requests.length, 2);
    assert.deepEqual(lastRoles(server.requests), ["user"]);
  },
);

// The tool ignores its abort signal, which holds the aborted run open while the key arrives.
const STUBBORN_TOOL_EXTENSION = `
export default function (pi) {
  pi.registerTool({
    name: "stubborn_tool",
    label: "stubborn_tool",
    description: "Finishes late even when aborted",
    parameters: { type: "object", properties: {} },
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { content: [{ type: "text", text: "late result" }], details: {} };
    },
  });
}
`;

scenario(
  "a shortcut pressed while an abort is settling retries once the abort has settled",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    const fixture = world.writeAgentFile("fixtures/stubborn-tool.ts", STUBBORN_TOOL_EXTENSION);
    let reply: ChatReply = { toolCall: { name: "stubborn_tool", arguments: "{}" } };
    const server = await probeServer(() => reply);
    const screen = terminal(["-e", fixture, ...PROBE_ARGS, "run the tool"]);
    await screen.waitForText("stubborn_tool");
    await delay(HOLD_MS);
    reply = { text: RETRIED };
    const before = server.requests.length;
    screen.send(ESCAPE);
    await delay(HOLD_MS);
    screen.send(F5);
    await screen.waitForText(RETRIED);
    assert.equal(server.requests.length, before + 1);
    assert.ok(!screen.text().includes(BUSY_NOTICE), screen.text());
  },
);
