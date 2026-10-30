import {
  convertToLlm,
  SessionManager,
  type BoundaryContextPreview,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { planCompaction } from "../compaction.ts";

type AppendableMessage = Parameters<SessionManager["appendMessage"]>[0];

function user(text: string): AppendableMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistant(text: string): AppendableMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "provider",
    model: "model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function toolResult(text: string): AppendableMessage {
  return {
    role: "toolResult",
    toolCallId: "tool-call",
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

/** The real host projects the session branch into the boundary context the
 * extension receives; the planner is driven with that projection, not a cast. */
function contextOf(manager: SessionManager): BoundaryContextPreview {
  const projection = manager.buildSessionProjection();
  return {
    contextEntries: projection.entries,
    contextMessages: projection.messages,
    llmMessages: convertToLlm(projection.messages),
    pendingMessages: [],
    canContinue: true,
  };
}

describe("projected-context compaction planning", () => {
  it("retains assistant/tool-result groups and summarizes only the prefix", () => {
    const manager = SessionManager.inMemory("/workspace");
    manager.appendMessage(user("old instructions"));
    const assistantId = manager.appendMessage(assistant("tool call"));
    manager.appendMessage(toolResult("x".repeat(1000)));

    const plan = planCompaction(contextOf(manager), 100);
    expect(plan?.firstKeptEntryId).toBe(assistantId);
    expect(plan?.messages).toHaveLength(1);
    expect(plan?.messages[0]).toMatchObject({ role: "user" });
  });

  it("includes earlier summaries in the summarized prefix", () => {
    const manager = SessionManager.inMemory("/workspace");
    const keptUserId = manager.appendMessage(user("x".repeat(4000)));
    manager.appendCompaction("previous summary", keptUserId, 2000);

    const plan = planCompaction(contextOf(manager), 100);
    expect(plan?.firstKeptEntryId).toBe(keptUserId);
    expect(plan?.messages[0].role).toBe("compactionSummary");
  });

  it("does not generate a no-op compaction for indivisible/small contexts", () => {
    const manager = SessionManager.inMemory("/workspace");
    manager.appendMessage(user("hello"));

    expect(planCompaction(contextOf(manager), 100)).toBeUndefined();
  });
});
