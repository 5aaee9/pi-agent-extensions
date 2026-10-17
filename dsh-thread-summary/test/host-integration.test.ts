import { setImmediate } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import { createUserMessage, LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { Session, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { SessionTitleService } from "@deepseek-ai/dsh-session-title";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { apply, inject } from "../index.ts";

async function createHost(stream: Context["llm"]["stream"]) {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(SessionProjectionRegistry).await();
  await ctx
    .plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 80,
      maxTitleBytes: 80,
    })
    .await();
  await ctx.plugin(LlmRuntime).await();
  const generate = vi.spyOn(ctx.llm, "stream").mockImplementation(stream);
  await ctx
    .plugin(
      { apply, inject: [...inject] },
      {
        enabled: true,
        model: "summary-provider/summary-model",
      },
    )
    .await();
  return { ctx, generate, session: ctx.sessions.create() };
}

function appendUserMessage(session: Session, text: string) {
  return session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
    { surfaceOp: "append" },
  );
}

function appendRequestHeader(session: Session, initial = true) {
  return session.append("request/header", {
    reason: initial ? "initial" : "change",
    header: { config: { provider: "main-provider", model: initial ? "main-model" : "next-model" } },
  });
}

function titleEvents(session: Session) {
  return session.snapshotEvents().filter((event) => event.type === "session/title");
}

async function* successfulStream(): AsyncGenerator<StreamChunk> {
  yield { type: "block-start", index: 0, blockType: "text" };
  yield { type: "text-delta", index: 0, text: ' "Fix login redirects." ' };
  yield { type: "block-end", index: 0, block: { type: "text", text: ' "Fix login redirects." ' } };
  yield { type: "finish", reason: { kind: "stop" } };
}

describe("thread summary with Harness services", () => {
  it("generates and logs the first-prompt title after the request header, without repeating on later prompts", async () => {
    const { ctx, generate, session } = await createHost(successfulStream);
    const first = appendUserMessage(session, "Fix the login redirect after signing in");

    // Automatic provider work waits for the main request's logged route.
    await setImmediate();
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: "Fix the login redirect after",
      messageSeqs: [first.seq],
      source: { kind: "fallback" },
    });

    appendRequestHeader(session);
    await setImmediate();
    expect(generate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        provider: "summary-provider",
        model: "summary-model",
        sessionId: session.id,
        purpose: "session-title",
      }),
    );
    const accepted = ctx.sessionTitle.get(session);
    expect(accepted).toMatchObject({
      title: "Fix login redirects",
      messageSeqs: [first.seq],
      source: {
        kind: "provider",
        provider: "dsh-thread-summary",
        model: { provider: "summary-provider", model: "summary-model" },
      },
    });
    expect(titleEvents(session).map((event) => event.data.source.kind)).toEqual([
      "fallback",
      "provider",
    ]);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe("Fix login redirects");

    appendUserMessage(session, "Also add regression coverage for logout");
    appendRequestHeader(session, false);
    await setImmediate();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(titleEvents(session)).toHaveLength(2);
    expect(ctx.sessionTitle.get(session)).toEqual(accepted);

    const replay = Session.create(session.id, session.snapshotEvents(), session.header);
    expect(ctx.sessionTitle.get(replay)).toEqual(accepted);
    expect(ctx.sessionProjections.snapshot(replay).values.title).toBe("Fix login redirects");
  });

  it("retains the logged deterministic fallback when the summary stream fails", async () => {
    const { ctx, generate, session } = await createHost(
      async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "text-delta", index: 0, text: "Incomplete summary" };
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: { code: "SUMMARY_UNAVAILABLE", message: "summary unavailable" },
          },
        };
      },
    );
    const first = appendUserMessage(
      session,
      "Investigate intermittent connection failures in production",
    );
    appendRequestHeader(session);
    await setImmediate();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: "Investigate intermittent connection failures in",
      messageSeqs: [first.seq],
      source: { kind: "fallback" },
    });
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe(
      "Investigate intermittent connection failures in",
    );

    appendUserMessage(session, "Check the connection pool too");
    appendRequestHeader(session, false);
    await setImmediate();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(titleEvents(session)).toHaveLength(1);
  });

  it("aborts an active summary on manual rename and rejects late stream output", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let streamClosed = false;
    const { ctx, generate, session } = await createHost(
      async function* (): AsyncGenerator<StreamChunk> {
        try {
          // Deliberately emulate a transport that ignores cancellation until it returns data.
          await blocked;
          yield* successfulStream();
        } finally {
          streamClosed = true;
        }
      },
    );
    try {
      appendUserMessage(session, "Fix the login redirect after signing in");
      appendRequestHeader(session);
      await setImmediate();
      expect(generate).toHaveBeenCalledTimes(1);
      const signal = generate.mock.calls[0]?.[0].signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      const renamed = ctx.sessionTitle.rename(session, "User chosen title");
      expect(signal?.aborted).toBe(true);
      expect(renamed).toMatchObject({
        title: "User chosen title",
        messageSeqs: [],
        source: { kind: "user" },
      });
      release();
      await setImmediate();
      expect(streamClosed).toBe(true);
      expect(ctx.sessionTitle.get(session)).toEqual(renamed);
      expect(titleEvents(session).map((event) => event.data.source.kind)).toEqual([
        "fallback",
        "user",
      ]);
      expect(ctx.sessionProjections.snapshot(session).values.title).toBe("User chosen title");

      appendUserMessage(session, "Continue with another task");
      appendRequestHeader(session, false);
      await setImmediate();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(ctx.sessionTitle.get(session)).toEqual(renamed);
    } finally {
      release();
    }
  });

  it("cancels queued automatic generation when renamed before the request header", async () => {
    const { ctx, generate, session } = await createHost(successfulStream);
    appendUserMessage(session, "Fix the login redirect after signing in");
    const renamed = ctx.sessionTitle.rename(session, "Pinned before generation");
    appendRequestHeader(session);
    await setImmediate();

    expect(generate).not.toHaveBeenCalled();
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionTitle.get(session)).toEqual(renamed);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe("Pinned before generation");
  });
});
