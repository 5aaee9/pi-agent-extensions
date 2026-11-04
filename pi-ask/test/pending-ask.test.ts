import assert from "node:assert/strict";
import { test } from "vitest";
import { findLatestPayloadInCurrentBranch } from "../src/ask-payload-store.ts";
import { ASK_PENDING_DISMISSED_ENTRY_TYPE, findPendingAskToolCall } from "../src/pending-ask.ts";
import type { AskParams } from "../src/types.ts";

const params: AskParams = {
  title: "Choose engine",
  questions: [
    {
      id: "engine",
      prompt: "Chart engine?",
      options: [
        { value: "canvas", label: "Canvas" },
        { value: "svg", label: "SVG" },
      ],
    },
  ],
};

function askToolCall(id: string, argumentsValue: unknown = params) {
  return assistantMessage([
    { type: "toolCall", id, name: "ask_user_question", arguments: argumentsValue },
  ]);
}

function assistantMessage(content: unknown[], stopReason = "toolUse") {
  return {
    type: "message",
    message: { role: "assistant", content, stopReason },
  };
}

function toolResult(toolCallId: string) {
  return {
    type: "message",
    message: { role: "toolResult", toolCallId, toolName: "ask_user_question" },
  };
}

function storedPayload(sourceEntryId: string, storedParams: unknown = params, version = 1) {
  return {
    type: "custom",
    customType: "ask:payload",
    data: {
      version,
      source: "tool",
      params: storedParams,
      sourceEntryId,
      timestamp: 1,
    },
  };
}

function dismissed(toolCallId: string) {
  return {
    type: "custom",
    customType: ASK_PENDING_DISMISSED_ENTRY_TYPE,
    data: { toolCallId },
  };
}

function scannerContext(branch: unknown[]) {
  return { sessionManager: { getBranch: () => branch } } as never;
}

test("pending ask scan selects the newest unresolved ask_user_question call", () => {
  const pending = findPendingAskToolCall(
    scannerContext([
      askToolCall("call-1"),
      storedPayload("call-1"),
      askToolCall("call-2"),
      storedPayload("call-2"),
      toolResult("call-2"),
    ]),
  );

  assert.deepEqual(pending, { params, toolCallId: "call-1" });
});

test("pending ask scan uses the latest unresolved call within one assistant message", () => {
  const pending = findPendingAskToolCall(
    scannerContext([
      assistantMessage([
        { type: "toolCall", id: "call-1", name: "ask_user_question", arguments: params },
        { type: "toolCall", id: "other", name: "read", arguments: {} },
        { type: "toolCall", id: "call-2", name: "ask_user_question", arguments: params },
      ]),
    ]),
  );

  assert.equal(pending?.toolCallId, "call-2");
});

test("pending ask scan ignores tool-shaped content from failed assistant responses", () => {
  assert.equal(
    findPendingAskToolCall(
      scannerContext([
        assistantMessage(
          [
            {
              type: "toolCall",
              id: "failed-call",
              name: "ask_user_question",
              arguments: params,
            },
          ],
          "error",
        ),
      ]),
    ),
    undefined,
  );
});

test("pending ask scan prefers its valid persisted payload", () => {
  const persistedParams = { ...params, title: "Persisted title" };
  const pending = findPendingAskToolCall(
    scannerContext([
      askToolCall("call-1", { ...params, title: "Recorded title" }),
      storedPayload("call-1", persistedParams),
    ]),
  );

  assert.equal(pending?.params, persistedParams);
});

test("pending ask scan validates recorded arguments as payload fallback", () => {
  assert.deepEqual(findPendingAskToolCall(scannerContext([askToolCall("call-1")])), {
    params,
    toolCallId: "call-1",
  });
  assert.deepEqual(
    findPendingAskToolCall(
      scannerContext([askToolCall("call-2"), storedPayload("call-2", params, 99)]),
    ),
    { params, toolCallId: "call-2" },
  );
  assert.deepEqual(
    findPendingAskToolCall(scannerContext([askToolCall("call-3"), storedPayload("call-3", {})])),
    { params, toolCallId: "call-3" },
  );
  assert.equal(
    findPendingAskToolCall(scannerContext([askToolCall("call-4", { questions: [] })])),
    undefined,
  );
  assert.equal(findPendingAskToolCall(scannerContext([askToolCall("call-5", {})])), undefined);
});

test("pending ask scan skips a newer invalid call for an older valid call", () => {
  const pending = findPendingAskToolCall(
    scannerContext([askToolCall("valid-call"), askToolCall("invalid-call", { questions: [] })]),
  );

  assert.deepEqual(pending, { params, toolCallId: "valid-call" });
});

test("pending ask scan ignores tool results and persisted dismissals", () => {
  assert.equal(
    findPendingAskToolCall(scannerContext([askToolCall("call-1"), toolResult("call-1")])),
    undefined,
  );
  assert.equal(
    findPendingAskToolCall(scannerContext([askToolCall("call-2"), dismissed("call-2")])),
    undefined,
  );
});

test("pending dismissal does not hide the payload from manual replay", () => {
  const lookup = findLatestPayloadInCurrentBranch(
    scannerContext([askToolCall("call-1"), storedPayload("call-1"), dismissed("call-1")]),
    "tool",
  );

  assert.equal(lookup.data?.params, params);
});
