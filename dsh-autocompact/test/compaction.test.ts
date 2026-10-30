/**
 * Surface-range selection over a real dsh session.
 *
 * The previous version replaced `toolPairingBalancedBefore` with a module
 * mock and built a plain object shaped like a Session. This version mounts the
 * real `SessionStore`/`TokenMeter` services, creates a real session, and lets
 * `selectCompactableRange` read the real surface and the real tool-pairing
 * implementation from `@deepseek-ai/dsh-compaction`. The token prices are the
 * token meter's own heuristic prices, not numbers supplied by the test.
 */
import { Context } from "@deepseek-ai/cordis";
import {
  ToolCallId,
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { TokenMeter } from "@deepseek-ai/dsh-token-meter";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
import { onTestFinished, describe, expect, it } from "vitest";
import { needsCompaction, selectCompactableRange, systemHead } from "../compaction.ts";

async function createSession(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(SessionProjectionRegistry).await();
  await ctx.plugin(TokenMeter).await();
  return { ctx, session: ctx.sessions.create() };
}

function appendText(session: Session, text: string): void {
  session.append(
    "user/message",
    createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
    { surfaceOp: "append" },
  );
}

function measure(ctx: Context, session: Session): TokenMeasurement {
  return ctx.tokenMeter.measure(session);
}

/** The price sum of a measurement suffix, used to pick a real retain boundary. */
function tailTokens(measurement: TokenMeasurement, count: number): number {
  return measurement.nodes
    .slice(Math.max(0, measurement.nodes.length - count))
    .reduce((sum, node) => sum + node.tokens, 0);
}

describe("surface range selection", () => {
  it("retains the priced recent tail and summarizes only the prefix", async () => {
    const { ctx, session } = await createSession();
    for (const text of ["a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(40)]) {
      appendText(session, text);
    }
    const measurement = measure(ctx, session);
    // Keeping the last two real prices leaves the first two messages in range.
    const range = selectCompactableRange(session, measurement, tailTokens(measurement, 2));
    expect(range).toEqual({
      start: session.surface.nodes[0],
      end: session.surface.nodes[1],
    });
  });

  it("never includes a leading system message in the range", async () => {
    const { ctx, session } = await createSession();
    session.append(
      "system/message",
      { turn: 1, step: 1, message: createSystemMessage("system prompt") },
      { surfaceOp: "append" },
    );
    for (const text of ["a".repeat(40), "b".repeat(40), "c".repeat(40)]) appendText(session, text);
    const measurement = measure(ctx, session);
    // The last real price keeps one message; the system head still stays out.
    const range = selectCompactableRange(session, measurement, tailTokens(measurement, 1));
    expect(range).toEqual({
      start: session.surface.nodes[1],
      end: session.surface.nodes[2],
    });
  });

  it("retains more history until the kept edge is a balanced tool-call boundary", async () => {
    const { ctx, session } = await createSession();
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    appendText(session, "a".repeat(40));
    const call = ToolCallId("call-1");
    session.append(
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: "tool-call", id: call, name: "read", arguments: "{}" }],
          source: { provider: "provider", model: "model" },
        }),
        stream: [],
      },
      { surfaceOp: "append" },
    );
    session.append(
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: call,
          content: [{ type: "text", text: "b".repeat(40) }],
          isError: false,
        }),
      },
      { surfaceOp: "append" },
    );
    session.append("step/end", { turn: 1, step: 1 });
    appendText(session, "c".repeat(40));

    const measurement = measure(ctx, session);
    // A cut before the tool result would split the assistant call from its
    // result, so the real pairing helper moves the kept edge past the pair.
    const range = selectCompactableRange(session, measurement, tailTokens(measurement, 2));
    expect(range).toEqual({
      start: session.surface.nodes[0],
      end: session.surface.nodes[0],
    });
  });

  it("does not generate a no-op compaction for indivisible or small contexts", async () => {
    const { ctx, session } = await createSession();
    appendText(session, "a".repeat(40));
    const single = measure(ctx, session);
    expect(selectCompactableRange(session, single, single.totalTokens)).toBeUndefined();

    appendText(session, "b".repeat(40));
    const pair = measure(ctx, session);
    expect(selectCompactableRange(session, pair, pair.totalTokens)).toBeUndefined();

    const empty = ctx.sessions.create();
    expect(selectCompactableRange(empty, measure(ctx, empty), 100)).toBeUndefined();
  });

  it("refuses a measurement that does not describe the current surface", async () => {
    const { ctx, session } = await createSession();
    appendText(session, "a".repeat(40));
    appendText(session, "b".repeat(40));
    const other = ctx.sessions.create();
    appendText(other, "c".repeat(40));
    const foreign = measure(ctx, other);

    expect(() => selectCompactableRange(session, foreign, 5)).toThrow(/does not match/);
  });

  it("detects only present usage above the threshold", () => {
    expect(needsCompaction({ totalTokens: 300001 }, 300000)).toBe(true);
    expect(needsCompaction({ totalTokens: 300000 }, 300000)).toBe(false);
    expect(needsCompaction({ totalTokens: undefined as unknown as number }, 300000)).toBe(false);
  });

  it("reads the surface head type from the real session event", async () => {
    const { session } = await createSession();
    session.append(
      "system/message",
      { turn: 1, step: 1, message: createSystemMessage("system prompt") },
      { surfaceOp: "append" },
    );
    appendText(session, "a".repeat(40));
    const [head, next] = session.surface.nodes as [SessionSeq, SessionSeq];
    expect(systemHead(session, head)).toBeDefined();
    expect(systemHead(session, next)).toBeUndefined();
  });
});
