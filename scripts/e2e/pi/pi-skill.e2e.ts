// `$skill` from the outside: what the model receives for a token and when, and
// what a person sees in a real terminal.
import assert from "node:assert/strict";

import { stripControl } from "./pty.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import type { ChatReply, LocalServer, RecordedRequest, SentMessage } from "./servers.ts";
import { messagesOf, rolesOf } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

const PACKAGES = { packages: ["pi-skill"] };
const SKILL_PATH = "skills/known/SKILL.md";
const SKILL_FILE = "---\nname: known\ndescription: a known skill\n---\n\nDo the known thing.\n";
const SKILL_BLOCK = /<skill name="known"[\s\S]*?<\/skill>/u;

function lastMessages(server: Readonly<Pick<LocalServer, "requests">>): readonly SentMessage[] {
  const request = server.requests.at(-1);
  assert.ok(request !== undefined, "no request reached the server");
  return messagesOf(request);
}

function blockIn(message: Readonly<SentMessage> | undefined): string {
  const [block] = SKILL_BLOCK.exec(message?.text ?? "") ?? [];
  assert.ok(block !== undefined, `no skill block in ${JSON.stringify(message)}`);
  return block;
}

scenario(
  "$known and /skill:known give the model the same block, ahead of the prompt",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.writeAgentFile(SKILL_PATH, SKILL_FILE);
    const server = await probeServer();
    const client = rpc(["--no-session", ...PROBE_ARGS]);
    await client.prompt("$known hi");
    const viaToken = lastMessages(server).filter((message) => message.role === "user");
    await client.send({ type: "new_session" });
    await client.prompt("/skill:known hi");
    const viaCommand = lastMessages(server).find((message) => message.role === "user");
    const [block, prompt] = viaToken;
    assert.equal(blockIn(block), blockIn(viaCommand));
    assert.equal(block?.text, blockIn(block), "the block is its own message");
    assert.equal(prompt?.text, "$known hi", "the prompt stays as the user wrote it");
    assert.equal(viaToken.length, 2);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "$$known reaches the model as written, with no skill block",
  PACKAGES,
  async ({ world, probeServer, rpc }) => {
    world.writeAgentFile(SKILL_PATH, SKILL_FILE);
    const server = await probeServer();
    const client = rpc(["--no-session", ...PROBE_ARGS]);
    await client.prompt("$$known hi");
    const sent = lastMessages(server).filter((message) => message.role === "user");
    assert.deepEqual(
      sent.map((message) => message.text),
      ["$$known hi"],
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

/** Queues `$known` while a tool-calling turn is held, then returns the requests that followed. */
async function queueDuringToolTurn(
  { world, probeServer, rpc }: Readonly<Scenario>,
  command: "steer" | "follow_up",
): Promise<readonly RecordedRequest[]> {
  world.writeAgentFile(SKILL_PATH, SKILL_FILE);
  const inFlight = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let first = true;
  const server = await probeServer((): ChatReply => {
    if (!first) return {};
    first = false;
    inFlight.resolve();
    return {
      toolCall: { name: "bash", arguments: JSON.stringify({ command: "true" }) },
      gate: async (): Promise<void> => {
        await release.promise;
      },
    };
  });
  const client = rpc(["--no-session", ...PROBE_ARGS]);
  const settled = client.next((event) => event["type"] === "agent_settled", "the run to settle");
  await client.send({ type: "prompt", message: "hello" });
  await inFlight.promise;
  const queued = await client.send({ type: command, message: "$known now" });
  assert.equal(queued["success"], true, JSON.stringify(queued));
  release.resolve();
  await settled;
  assert.deepEqual(client.extensionErrors(), []);
  return server.requests;
}

const hasSkillBlock = (request: Readonly<RecordedRequest>): boolean =>
  messagesOf(request).some((message) => SKILL_BLOCK.test(message.text));

/** The block and the words it came with reach the model together, block first. */
function assertDeliveredTogether(requests: readonly RecordedRequest[]): void {
  const carrying = requests.filter((request) => hasSkillBlock(request));
  assert.ok(carrying.length > 0, "no request carried the skill block");
  const message = messagesOf(carrying[0] as RecordedRequest).find((sent) =>
    SKILL_BLOCK.test(sent.text),
  );
  assert.ok(message?.text.endsWith("\n\n$known now"), JSON.stringify(message));
  assert.equal(blockIn(message), message.text.slice(0, -"\n\n$known now".length));
}

const afterToolResult = (requests: readonly RecordedRequest[]): RecordedRequest => {
  const request = requests.find((candidate) => rolesOf(candidate).includes("tool"));
  assert.ok(request !== undefined, "no request carried the tool result");
  return request;
};

scenario(
  "a steered $known reaches the model right after the running tool finishes",
  PACKAGES,
  async (context) => {
    const requests = await queueDuringToolTurn(context, "steer");
    assert.ok(hasSkillBlock(afterToolResult(requests)));
    assertDeliveredTogether(requests);
    assert.equal(requests.length, 2, "the block takes no model turn of its own");
  },
);

scenario("a follow-up $known waits until the running turn has ended", PACKAGES, async (context) => {
  const requests = await queueDuringToolTurn(context, "follow_up");
  assert.ok(!hasSkillBlock(afterToolResult(requests)));
  assertDeliveredTogether(requests);
  assert.equal(requests.length, 3, "the block takes no model turn of its own");
});

scenario(
  "a $known typed while the model is answering renders as a block in a terminal",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    world.writeAgentFile(SKILL_PATH, SKILL_FILE);
    const release = Promise.withResolvers<void>();
    let first = true;
    await probeServer((): ChatReply => {
      if (!first) return { text: "queued reply" };
      first = false;
      return {
        text: "first reply",
        gate: async (): Promise<void> => {
          await release.promise;
        },
      };
    });
    const pi = terminal(["--no-session", ...PROBE_ARGS]);
    await pi.waitForText("[Extensions]");
    const typed = pi.mark();
    pi.send("hello\r");
    await pi.waitForText("hello", { mark: typed });
    const queued = pi.mark();
    pi.send("$known now\r");
    // Pi previews a queued /skill: the same way, as truncated raw text, until delivery.
    await pi.waitForText("Steering:", { mark: queued });
    const delivered = pi.mark();
    release.resolve();
    await pi.waitForText("[skill] known", { mark: delivered });
    await pi.waitForText("queued reply", { mark: delivered });
    assert.ok(!stripControl(pi.raw().slice(delivered)).includes("<skill name="));
  },
);

scenario(
  "typing $ in a terminal offers the skill, and sending it renders a collapsed block",
  PACKAGES,
  async ({ world, probeServer, terminal }) => {
    world.writeAgentFile(SKILL_PATH, SKILL_FILE);
    await probeServer(() => ({ text: "skill reply" }));
    const pi = terminal(["--no-session", ...PROBE_ARGS]);
    await pi.waitForText("[Extensions]");
    const ready = pi.mark();
    pi.send("$");
    await pi.waitForText("a known skill", { mark: ready });
    const offered = pi.mark();
    pi.send("\t");
    await pi.waitForText("$known ", { mark: offered });
    const completed = pi.mark();
    pi.send("hi\r");
    await pi.waitForText("[skill] known", { mark: completed });
    await pi.waitForText("skill reply", { mark: completed });
    const shown = stripControl(pi.raw().slice(completed));
    assert.ok(shown.includes("$known hi"), "the prompt stays as the user wrote it");
    assert.ok(!shown.includes("<skill name="), "the block must not show its raw XML");
  },
);
