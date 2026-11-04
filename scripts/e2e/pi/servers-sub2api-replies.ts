// What a Sub2API relay sends on the wire: Responses, compaction, Messages, and billing.
import type { JsonRecord } from "../../release/json.ts";
import { json, sse } from "./servers.ts";
import type { Reply } from "./servers.ts";

export const RESPONSES_USAGE: JsonRecord = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 20 },
  output_tokens: 10,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 110,
};

export const sseEvent = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

/** A complete Responses stream answering with `text`. */
export function textReply(text = "pong", usage: JsonRecord = RESPONSES_USAGE): Reply {
  const message = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const position = { output_index: 0, content_index: 0, item_id: message.id };
  return sse(
    [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
      {
        type: "response.content_part.added",
        ...position,
        part: { type: "output_text", text: "", annotations: [] },
      },
      { type: "response.output_text.delta", ...position, delta: text },
      { type: "response.output_item.done", output_index: 0, item: message },
      {
        type: "response.completed",
        response: { id: "resp_1", status: "completed", output: [message], usage },
      },
    ].map((event: unknown) => sseEvent(event)),
  );
}

export interface ToolCallFixture {
  readonly name: string;
  readonly args: string;
  readonly encryptedReasoning?: string;
}

/** A Responses stream calling one client tool, optionally with encrypted reasoning. */
export function toolCallReply(call: ToolCallFixture): Reply {
  const reasoning =
    call.encryptedReasoning === undefined
      ? []
      : [
          {
            type: "reasoning",
            id: "rs_1",
            summary: [],
            encrypted_content: call.encryptedReasoning,
          },
        ];
  const item = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: call.name,
    arguments: call.args,
    status: "completed",
  };
  const output: readonly JsonRecord[] = [...reasoning, item];
  return sse(
    [
      { type: "response.created", response: { id: "resp_tool", status: "in_progress" } },
      ...output.flatMap((entry: JsonRecord, index) => [
        { type: "response.output_item.added", output_index: index, item: entry },
        { type: "response.output_item.done", output_index: index, item: entry },
      ]),
      {
        type: "response.completed",
        response: { id: "resp_tool", status: "completed", output, usage: RESPONSES_USAGE },
      },
    ].map((event: unknown) => sseEvent(event)),
  );
}

export interface CompactionFixture {
  readonly opaque?: string;
  readonly itemType?: string;
  readonly usage?: JsonRecord;
}

/** Remote compaction's stream: one opaque output item, then completion. */
export function compactionReply(fixture: CompactionFixture = {}): Reply {
  const item = {
    id: null,
    type: fixture.itemType ?? "compaction",
    encrypted_content: fixture.opaque ?? "OPAQUE-1",
  };
  const response = {
    id: "cmp_1",
    status: "completed",
    created_at: 1_800_000_000,
    output: [item],
    usage: fixture.usage ?? RESPONSES_USAGE,
  };
  return sse([
    sseEvent({ type: "response.output_item.done", item }),
    sseEvent({ type: "response.completed", response }),
  ]);
}

const namedEvent = (type: string, data: JsonRecord): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** An Anthropic Messages stream answering with `text`. */
export function anthropicReply(text = "pong"): Reply {
  const message = {
    id: "msg_a",
    type: "message",
    role: "assistant",
    content: [],
    model: "claude",
    stop_reason: null,
    usage: { input_tokens: 10, output_tokens: 1 },
  };
  return sse([
    namedEvent("message_start", { message }),
    namedEvent("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    namedEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    namedEvent("content_block_stop", { index: 0 }),
    namedEvent("message_delta", {
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 2 },
    }),
    namedEvent("message_stop", {}),
  ]);
}

/** Sub2API's key-billing document at an effective rate. */
export const billingReply = (effective: number, schemaVersion = 1): Reply =>
  json({
    object: "sub2api.key_billing",
    schema_version: schemaVersion,
    billing_scope: "token",
    group_rate_multiplier: effective,
    resolved_rate_multiplier: effective,
    peak_rate_enabled: false,
    effective_rate_multiplier: effective,
  });

export const NOT_FOUND = (): Reply => json({ error: "not found" }, 404);
