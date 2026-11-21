// Antigravity rejects Pi's identity sentence and accepts the same request once that
// sentence is replaced. The rule has to change only that sentence, and only for a
// model the provider's pattern names.
import assert from "node:assert/strict";

import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import { CODEX, PACKAGE, modelArgs, inputOf } from "./pi-provider-sub2api-support.ts";

const IDENTITY =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const NEUTRAL = "You are a helpful, knowledgeable, and direct AI assistant.";
const KEPT = "Be concise in your responses";

function turnBody(request: RecordedRequest | undefined): Readonly<Record<string, unknown>> {
  assert.ok(request !== undefined, "a request reached the server");
  return bodyOf(request);
}

function promptOf(request: RecordedRequest | undefined, role: string): string {
  assert.equal("instructions" in turnBody(request), false);
  const lead = inputOf(request).at(0);
  assert.equal(lead?.["role"], role);
  const content = lead["content"];
  assert.ok(typeof content === "string");
  return content;
}

const MANIFEST = manifestOf([
  { slug: "gemini-2.5-pro", supported_reasoning_levels: ["low", "high"] },
  { slug: "claude-sonnet-4-5" },
  { slug: "gpt-5.4" },
]);

function assertUserPrompt(request: RecordedRequest | undefined): void {
  const user = inputOf(request).find((item) => item["role"] === "user");
  assert.deepEqual(user?.["content"], [{ type: "input_text", text: IDENTITY }]);
}

scenario(
  "a prompt replacement rewrites only the matching model's system prompt and leaves the rest of the request",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, {
      manifest: MANIFEST,
    });
    const entry = { baseURL: relay.v1, token: "tok", api: CODEX };
    world.writeAgentFile("sub2api.json", {
      relay: {
        ...entry,
        promptReplacements: [{ models: ["gemini-*", "claude-*"], from: IDENTITY, to: NEUTRAL }],
      },
      plain: entry,
    });
    const client = rpc(modelArgs(world, "relay", "gemini-2.5-pro"));

    await client.prompt(IDENTITY);
    const gemini = turnBody(relay.turns().at(-1));
    const geminiInstructions = promptOf(relay.turns().at(-1), "developer");
    assert.ok(geminiInstructions.includes(NEUTRAL));
    assert.equal(geminiInstructions.includes(IDENTITY), false);
    assert.ok(geminiInstructions.includes(KEPT));
    assertUserPrompt(relay.turns().at(-1));
    assert.ok(Array.isArray(gemini["tools"]));
    assert.equal(gemini["model"], "gemini-2.5-pro");

    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-5.4" });
    await client.prompt("gpt");
    const gpt = promptOf(relay.turns().at(-1), "system");
    assert.ok(gpt.includes(IDENTITY));
    assert.equal(gpt.includes(NEUTRAL), false);
    assert.ok(gpt.includes(KEPT));

    await client.send({ type: "set_model", provider: "relay", modelId: "claude-sonnet-4-5" });
    await client.prompt("claude");
    const claude = promptOf(relay.turns().at(-1), "system");
    assert.ok(claude.includes(NEUTRAL));
    assert.equal(claude.includes(IDENTITY), false);
    assert.ok(claude.includes(KEPT));

    await client.send({ type: "set_model", provider: "plain", modelId: "gemini-2.5-pro" });
    await client.prompt("plain");
    const plain = promptOf(relay.turns().at(-1), "developer");
    assert.ok(plain.includes(IDENTITY));
    assert.equal(plain.includes(NEUTRAL), false);
    assert.ok(plain.includes(KEPT));

    assert.deepEqual(client.extensionErrors(), []);
  },
);
