import assert from "node:assert/strict";
import { isRecord } from "../../release/json.ts";
import type { RpcClient, RpcEvent } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf, sse } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { compactionReply, sseEvent } from "./servers-sub2api-replies.ts";
import {
  PACKAGE,
  compactionEntries,
  inputOf,
  modelArgs,
  runCommand,
} from "./pi-provider-sub2api-support.ts";
import {
  COMPLETED,
  MARKER_SUMMARY,
  codexRelay,
  compact,
  openClient,
  windowOf,
} from "./pi-provider-sub2api-compaction-support.ts";

const BASE = "You are a coding assistant running inside pi";
const FORCED = "FORCED PROMPT FOR THIS TURN";
const forcePrompt = `pi.on("before_agent_start", () => ({systemPrompt: ${JSON.stringify(FORCED)}}));`;
const removeTool = `pi.registerCommand("drop-bash", {handler: (_args, ctx) => {
  pi.setActiveTools(pi.getActiveTools().filter(name => name !== "bash")); ctx.ui.notify("dropped bash");
}});`;
function withExtension({ world, rpc }: Scenario, source: string): RpcClient {
  const fixture = world.writeAgentFile(
    "prompt-test.ts",
    `export default function(pi) { ${source} }`,
  );
  return rpc(["--extension", fixture, ...modelArgs(world, "relay", "gpt-conv")]);
}
function promptOf(request: RecordedRequest | undefined): string {
  const lead = inputOf(request).at(0);
  assert.equal(lead?.["role"], "developer");
  const content = lead["content"];
  assert.ok(typeof content === "string");
  return content;
}
function overrideCompat(context: Scenario, flag: string): void {
  context.world.writeAgentFile("models.json", {
    providers: { relay: { modelOverrides: { "gpt-conv": { compat: { [flag]: true } } } } },
  });
}

function noPrompt(items: readonly unknown[]): void {
  assert.equal(
    items.some((item) => isRecord(item) && ["developer", "system"].includes(String(item["role"]))),
    false,
  );
}
function assertReplay(request: RecordedRequest | undefined): void {
  assert.ok(inputOf(request).some((item) => item["encrypted_content"] === "OPAQUE-1"));
  assert.ok(!JSON.stringify(inputOf(request)).includes(MARKER_SUMMARY));
}
scenario(
  "a new checkpoint retains the conversation but not its system prompt",
  PACKAGE,
  async (context) => {
    await codexRelay(context);
    const client = openClient(context);
    await client.prompt("retain me");
    await compact(client);
    const window = windowOf(compactionEntries(context.world).at(-1));
    noPrompt(window);
    assert.ok(JSON.stringify(window).includes("retain me"));
  },
);
scenario(
  "evicting an oversized latest user message cannot evict the next turn's system prompt",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await client.prompt("x".repeat(300_000));
    const prompt = promptOf(relay.turns().at(-1));
    await compact(client);
    await client.prompt("next");
    const next = relay.turns().at(-1);
    assert.equal(promptOf(next), prompt);
    assert.equal(inputOf(next).at(1)?.["encrypted_content"], "OPAQUE-1");
  },
);
scenario(
  "removing an active tool after a checkpoint does not break replay",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = withExtension(context, removeTool);
    await client.prompt("first");
    assert.ok(promptOf(relay.turns().at(-1)).includes("- bash:"));
    await compact(client);
    await runCommand(client, "/drop-bash", "dropped bash");
    await client.prompt("next");
    const next = relay.turns().at(-1);
    assert.ok(promptOf(next).includes(BASE));
    assert.ok(!promptOf(next).includes("- bash:"));
    assertReplay(next);
  },
);
scenario(
  "idle compaction uses the base prompt; replay keeps the forced prompt",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = withExtension(context, forcePrompt);
    await client.prompt("first");
    await runCommand(client, "/openai-compress", COMPLETED);
    const idle = relay.compactions().at(-1);
    assert.ok(idle && promptOf(idle).includes(BASE));
    await client.prompt("next");
    assert.equal(promptOf(relay.turns().at(-1)), FORCED);
    assertReplay(relay.turns().at(-1));
    assert.equal("instructions" in bodyOf(idle), false);
  },
);
scenario(
  "overflow compaction carries the forced prompt, not the recorded prompt",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    context.world.mergeSettings({
      compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 16 },
    });
    const client = withExtension(context, forcePrompt);
    await client.prompt("first");
    await client.prompt("second");
    relay.queueTurns(
      sse([
        sseEvent({
          type: "error",
          code: "context_length_exceeded",
          message: "Your input exceeds the context window of this model.",
        }),
      ]),
    );
    const end = client.next((event) => event["type"] === "compaction_end", "overflow compaction");
    await client.send({ type: "prompt", message: "third" });
    await end;
    assert.equal(promptOf(relay.compactions().at(-1)), FORCED);
  },
);
scenario(
  "first and repeated compaction send one current prompt in input, never instructions",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    await client.prompt("first");
    const current = promptOf(relay.turns().at(-1));
    await compact(client);
    await client.prompt("second");
    await compact(client);
    assert.equal(relay.compactions().length, 2);
    for (const request of relay.compactions()) {
      assert.equal(promptOf(request), current);
      assert.equal("instructions" in bodyOf(request), false);
      noPrompt(inputOf(request).slice(1));
      assert.deepEqual(inputOf(request).at(-1), { type: "compaction_trigger" });
    }
  },
);
scenario(
  "a mid-conversation effort override replays the checkpoint and keeps the current effort",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    overrideCompat(context, "supportsMidConvoEffort");
    const client = openClient(context);
    await client.send({ type: "set_thinking_level", level: "low" });
    await client.prompt("first");
    await compact(client);
    await client.send({ type: "set_thinking_level", level: "high" });
    await client.prompt("next");
    const next = relay.turns().at(-1);
    assertReplay(next);
    assert.deepEqual(inputOf(next).at(-1), {
      type: "configuration_update",
      reasoning: { effort: "high" },
    });
  },
);

scenario(
  "mid-conversation system updates replay but do not enter the next window",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    overrideCompat(context, "supportsMidConvoSystemMessages");
    relay.route({
      compaction: () => compactionReply({ opaque: "OPAQUE-" + String(relay.compactions().length) }),
    });
    const client = withExtension(context, removeTool);
    await client.prompt("first");
    await compact(client);
    await client.prompt("second");
    await runCommand(client, "/drop-bash", "dropped bash");
    await client.prompt("third");
    assertReplay(relay.turns().at(-1));
    await compact(client);
    const second = relay.compactions().at(1);
    assert.ok(promptOf(second).includes(BASE));
    assert.ok(!promptOf(second).includes("- bash:"));
    noPrompt(inputOf(second).slice(1));
    noPrompt(windowOf(compactionEntries(context.world).at(-1)));
    await client.prompt("fourth");
    assert.ok(
      inputOf(relay.turns().at(-1)).some((item) => item["encrypted_content"] === "OPAQUE-2"),
    );
  },
);

scenario(
  "a folded tool change is neither repeated in the second request nor retained",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = withExtension(context, removeTool);
    await client.prompt("first");
    assert.ok(promptOf(relay.turns().at(-1)).includes("- bash:"));
    await compact(client);
    await client.prompt("second");
    await runCommand(client, "/drop-bash", "dropped bash");
    await client.prompt("third");
    await compact(client);
    const second = relay.compactions().at(1);
    assert.ok(promptOf(second).includes(BASE));
    assert.ok(!promptOf(second).includes("- bash:"));
    noPrompt(inputOf(second).slice(1));
    noPrompt(windowOf(compactionEntries(context.world).at(-1)));
  },
);
scenario(
  "custom guidance stays off the wire with one notice; blank guidance and the command stay quiet",
  PACKAGE,
  async (context) => {
    const relay = await codexRelay(context);
    const client = openClient(context);
    const notices = (): readonly RpcEvent[] =>
      client.events.filter(
        (event) =>
          event["method"] === "notify" &&
          /native compaction ignores custom instructions/iu.test(String(event["message"])),
      );
    await client.prompt("first");
    const conversation = inputOf(relay.turns().at(-1)).at(-1);
    await client.send({ type: "compact", customInstructions: "FOCUS-GUIDANCE" });
    const request = relay.compactions().at(-1);
    assert.ok(request && !request.body.includes("FOCUS-GUIDANCE"));
    const input = inputOf(request);
    assert.deepEqual(input.at(-3), conversation);
    assert.equal(input.at(-2)?.["role"], "assistant");
    assert.deepEqual(input.at(-1), { type: "compaction_trigger" });
    assert.equal(notices().length, 1);
    await client.prompt("second");
    await client.send({ type: "compact", customInstructions: "  " });
    await client.prompt("third");
    await runCommand(client, "/openai-compress", COMPLETED);
    assert.equal(relay.compactions().length, 3);
    assert.equal(notices().length, 1);
  },
);
