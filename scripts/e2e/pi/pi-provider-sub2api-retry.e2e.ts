// Relay failures from the outside: what Pi retries, and overflow recovery.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { json, sse } from "./servers.ts";
import type { Reply } from "./servers.ts";
import { inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import { sseEvent } from "./servers-sub2api-replies.ts";
import {
  MANUAL_COMPACTION,
  PACKAGE,
  inSequence,
  modelArgs,
  sessionEntries,
} from "./pi-provider-sub2api-support.ts";
import type { World } from "./world.ts";

const MANIFEST = manifestOf([
  {
    slug: "gpt-5.5",
    context_window: 200_000,
    max_output_tokens: 16_000,
    supported_reasoning_levels: ["low", "high"],
  },
]);

const RETRY_SETTINGS = {
  retry: { enabled: true, maxRetries: 2, baseDelayMs: 10 },
  compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 16 },
};

interface FailureRow {
  readonly shape: string;
  readonly failure: Reply;
  readonly attempts: number;
}

const failedWith = (code: string, message: string): Reply =>
  sse([sseEvent({ type: "response.failed", response: { error: { code, message } } })]);

const FAILURES: readonly FailureRow[] = [
  {
    shape: "SSE error with code",
    failure: sse([sseEvent({ type: "error", code: "stream_read_error", message: "" })]),
    attempts: 2,
  },
  {
    shape: "SSE error with message",
    failure: sse([sseEvent({ type: "error", message: "stream_read_error" })]),
    attempts: 2,
  },
  {
    shape: "response.failed stream_read_error",
    failure: failedWith("stream_read_error", "stream_read_error"),
    attempts: 2,
  },
  {
    shape: "response.failed Upstream request failed",
    failure: failedWith("upstream_error", "Upstream request failed"),
    attempts: 2,
  },
  {
    shape: "HTTP 502",
    failure: json({ error: { message: "Upstream request failed" } }, 502),
    attempts: 2,
  },
  {
    shape: "stream closed before a terminal event",
    failure: sse([
      sseEvent({ type: "response.created", response: { id: "x", status: "in_progress" } }),
    ]),
    attempts: 2,
  },
  {
    shape: "response.failed permanent",
    failure: failedWith("invalid_request", "the request was rejected"),
    attempts: 1,
  },
];

function lastAssistant(world: World): JsonRecord | undefined {
  return sessionEntries(world)
    .map((entry) => entry["message"])
    .filter((message) => isRecord(message))
    .findLast((message) => message["role"] === "assistant");
}

scenario(
  "a relayed stream_read_error reaches a second attempt and succeeds, in all three wire shapes",
  PACKAGE,
  async ({ world, server, rpc }) => {
    world.mergeSettings(RETRY_SETTINGS);
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    const seen = await inSequence(FAILURES, async ({ shape, failure }) => {
      const before = relay.turns().length;
      relay.queueTurns(failure);
      await client.prompt(`hello ${shape}`);
      return { shape, attempts: relay.turns().length - before };
    });
    assert.deepEqual(
      seen,
      FAILURES.map(({ shape, attempts }) => ({ shape, attempts })),
    );
    const retries = client.events.filter((event) => event["type"] === "auto_retry_start");
    assert.equal(retries.length, FAILURES.filter(({ attempts }) => attempts === 2).length);
  },
);

scenario(
  "a retried stream_read_error leaves the turn answered, with no error on the final message",
  PACKAGE,
  async ({ world, server, rpc }) => {
    world.mergeSettings(RETRY_SETTINGS);
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
    relay.queueTurns(failedWith("stream_read_error", "stream_read_error"));
    await client.prompt("hello");
    const final = lastAssistant(world);
    assert.ok(final !== undefined);
    assert.equal(final["stopReason"], "stop", JSON.stringify(final));
    assert.equal(final["errorMessage"], undefined);
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "a context overflow from the relay recovers through native compaction and replays the checkpoint",
  PACKAGE,
  async ({ world, server, rpc }) => {
    world.mergeSettings(RETRY_SETTINGS);
    const relay = await startRelay(server, { manifest: MANIFEST });
    world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-codex-responses" },
    });
    const client = rpc(modelArgs(world, "relay", "gpt-5.5"));
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
    const recovered = relay.waitFor("/v1/responses", 5);
    const compacted = client.next(
      (event) => event["type"] === "compaction_end",
      "the overflow compaction",
    );
    await client.send({ type: "prompt", message: "third" });
    await compacted;
    const settled = client.next((event) => event["type"] === "agent_settled", "the recovered turn");
    await recovered;
    await settled;
    assert.equal(relay.compactions().length, 1);
    assert.equal(client.events.filter((event) => event["type"] === "auto_retry_start").length, 0);
    assert.equal(
      relay.turns().at(-1)?.body.includes("OPAQUE-1"),
      true,
      "the retry replays the checkpoint",
    );
    assert.equal(lastAssistant(world)?.["stopReason"], "stop");
  },
);

scenario(
  "a redirect from the relay is refused on Codex and xAI turns, so no credential follows it",
  PACKAGE,
  async ({ world, server, rpc }) => {
    world.mergeSettings(MANUAL_COMPACTION);
    const redirect: Reply = { status: 302, headers: { location: "/v1/elsewhere" } };
    const codex = await startRelay(server, { manifest: MANIFEST });
    const grok = await startRelay(server, { inventory: inventoryOf([{ id: "grok-e2e" }]) });
    world.writeAgentFile("sub2api.json", {
      codex: { baseURL: codex.v1, token: "tok", api: "openai-codex-responses" },
      grok: { baseURL: grok.v1, token: "tok", api: "xai" },
    });
    const client = rpc(modelArgs(world, "codex", "gpt-5.5"));
    codex.queueTurns(redirect);
    await client.prompt("through codex");
    assert.equal(codex.turns().length, 1);
    assert.deepEqual(codex.at("/v1/elsewhere"), []);
    await client.send({ type: "set_model", provider: "grok", modelId: "grok-e2e" });
    grok.queueTurns(redirect);
    await client.prompt("through xai");
    assert.equal(grok.turns().length, 1);
    assert.deepEqual(grok.at("/v1/elsewhere"), []);
  },
);
