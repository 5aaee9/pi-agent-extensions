// Antigravity rejects Pi's identity sentence and accepts the same request once that
// sentence is replaced. The rule has to change only that sentence, and only for a
// model the provider's pattern names.
import assert from "node:assert/strict";

import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import { CODEX, PACKAGE, modelArgs } from "./pi-provider-sub2api-support.ts";

const IDENTITY =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const NEUTRAL = "You are a helpful, knowledgeable, and direct AI assistant.";
const KEPT = "Be concise in your responses";

function turnBody(request: RecordedRequest | undefined): Readonly<Record<string, unknown>> {
  assert.ok(request !== undefined, "a request reached the server");
  return bodyOf(request);
}

function instructionsOf(body: Readonly<Record<string, unknown>>): string {
  const instructions = body["instructions"];
  if (typeof instructions !== "string") assert.fail("instructions must be a string");
  return instructions;
}

scenario(
  "a prompt replacement rewrites only the matching model's instructions and leaves the rest of the request",
  PACKAGE,
  async ({ world, server, rpc }) => {
    const relay = await startRelay(server, {
      manifest: manifestOf([
        { slug: "gemini-2.5-pro" },
        { slug: "claude-sonnet-4-5" },
        { slug: "gpt-5.4" },
      ]),
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

    await client.prompt("gemini");
    const gemini = turnBody(relay.turns().at(-1));
    const geminiInstructions = instructionsOf(gemini);
    assert.ok(geminiInstructions.includes(NEUTRAL));
    assert.equal(geminiInstructions.includes(IDENTITY), false);
    assert.ok(geminiInstructions.includes(KEPT));
    assert.ok(Array.isArray(gemini["tools"]));
    assert.equal(gemini["model"], "gemini-2.5-pro");

    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-5.4" });
    await client.prompt("gpt");
    const gpt = instructionsOf(turnBody(relay.turns().at(-1)));
    assert.ok(gpt.includes(IDENTITY));
    assert.equal(gpt.includes(NEUTRAL), false);
    assert.ok(gpt.includes(KEPT));

    await client.send({ type: "set_model", provider: "relay", modelId: "claude-sonnet-4-5" });
    await client.prompt("claude");
    const claude = instructionsOf(turnBody(relay.turns().at(-1)));
    assert.ok(claude.includes(NEUTRAL));
    assert.equal(claude.includes(IDENTITY), false);
    assert.ok(claude.includes(KEPT));

    await client.send({ type: "set_model", provider: "plain", modelId: "gemini-2.5-pro" });
    await client.prompt("plain");
    const plain = instructionsOf(turnBody(relay.turns().at(-1)));
    assert.ok(plain.includes(IDENTITY));
    assert.equal(plain.includes(NEUTRAL), false);
    assert.ok(plain.includes(KEPT));

    assert.deepEqual(client.extensionErrors(), []);
  },
);
