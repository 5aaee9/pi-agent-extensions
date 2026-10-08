import { describe, expect, it } from "vitest";
import type { BoundaryState } from "@earendil-works/pi-coding-agent";
import { planCompaction } from "../compaction.ts";

function context(messages: Array<{ id: string; role: string; text: string }>) {
  return {
    contextEntries: messages.map(({ id, role, text }) => ({
      sourceEntry: { id },
      messages: [{ role, content: [{ type: "text", text }] }],
    })),
  } as unknown as BoundaryState["context"];
}

describe("projected-context compaction planning", () => {
  it("retains assistant/tool-result groups and summarizes only the prefix", () => {
    const plan = planCompaction(
      context([
        { id: "old", role: "user", text: "old instructions" },
        { id: "assistant", role: "assistant", text: "tool call" },
        { id: "tool", role: "toolResult", text: "x".repeat(1000) },
      ]),
      100,
    );
    expect(plan?.firstKeptEntryId).toBe("assistant");
    expect(plan?.messages).toHaveLength(1);
  });
  it("includes earlier summaries in the summarized prefix", () => {
    const plan = planCompaction(
      context([
        { id: "summary", role: "compactionSummary", text: "previous summary" },
        { id: "latest", role: "user", text: "x".repeat(1000) },
      ]),
      100,
    );
    expect(plan?.firstKeptEntryId).toBe("latest");
    expect(plan?.messages[0].role).toBe("compactionSummary");
  });
  it("does not generate a no-op compaction for indivisible/small contexts", () => {
    expect(
      planCompaction(context([{ id: "only", role: "user", text: "hello" }]), 100),
    ).toBeUndefined();
  });
});
