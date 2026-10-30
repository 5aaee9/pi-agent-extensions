import { setImmediate } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { createUserMessage, LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Session, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { SessionTitleService } from "@deepseek-ai/dsh-session-title";
import { describe, expect, it, onTestFinished } from "vitest";
import { apply, inject } from "../index.ts";

/**
 * Drives the real pinned Harness service graph (Cordis, SessionStore,
 * projections, AgentRegistry, SessionTitleService, LlmRuntime) and the real
 * plugin. The `llm/stream` listener delegates to the real adapter dispatch and
 * only records the request, so no stream is replaced. Assertions that need an
 * actual model response are credential-gated (OpenSpec task 4.1) and therefore
 * live outside this file rather than behind a fake or a silent skip.
 */
async function createHost() {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(SessionProjectionRegistry).await();
  await ctx.plugin(AgentRegistry).await();
  await ctx
    .plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 80,
      maxTitleBytes: 80,
    })
    .await();
  await ctx.plugin(LlmRuntime).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  const fiber = await ctx
    .plugin(
      { apply, inject: [...inject] },
      {
        enabled: true,
        model: "summary-provider/summary-model",
      },
    )
    .await();
  return { ctx, calls, fiber, session: ctx.sessions.create() };
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

describe("thread summary with Harness services", () => {
  it("requests the first-prompt summary once after the request header and never on later prompts", async () => {
    const { ctx, calls, session } = await createHost();
    const first = appendUserMessage(session, "Fix the login redirect after signing in");

    // Automatic provider work waits for the main request's logged route.
    await setImmediate();
    expect(calls).toHaveLength(0);
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: "Fix the login redirect after",
      messageSeqs: [first.seq],
      source: { kind: "fallback" },
    });

    appendRequestHeader(session);
    await setImmediate();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "summary-provider",
      model: "summary-model",
      sessionId: session.id,
      purpose: "session-title",
    });
    // No keyless model route exists in this environment, so the real runtime
    // reports the missing adapter and the service keeps the deterministic
    // fallback. Accepting a provider-generated title is credential-gated.
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: "Fix the login redirect after",
      messageSeqs: [first.seq],
      source: { kind: "fallback" },
    });
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe(
      "Fix the login redirect after",
    );

    appendUserMessage(session, "Also add regression coverage for logout");
    appendRequestHeader(session, false);
    await setImmediate();
    expect(calls).toHaveLength(1);
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: "Fix the login redirect after",
      source: { kind: "fallback" },
    });

    const replay = Session.create(session.id, session.snapshotEvents(), session.header);
    expect(ctx.sessionTitle.get(replay)).toMatchObject({
      title: "Fix the login redirect after",
      source: { kind: "fallback" },
    });
    expect(ctx.sessionProjections.snapshot(replay).values.title).toBe(
      "Fix the login redirect after",
    );
  });

  it("retains the logged deterministic fallback when the summary stream fails", async () => {
    const { ctx, calls, session } = await createHost();
    const first = appendUserMessage(
      session,
      "Investigate intermittent connection failures in production",
    );
    appendRequestHeader(session);
    await setImmediate();

    // The real runtime normalizes the missing adapter into a terminal error
    // finish chunk, the same failure surface a provider error uses.
    expect(calls).toHaveLength(1);
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
    expect(calls).toHaveLength(1);
    expect(titleEvents(session)).toHaveLength(1);
  });

  it("registers the sole session-title provider with the real service", async () => {
    expect(inject).toEqual(["llm", "sessionTitle"]);
    const { ctx, fiber } = await createHost();
    await expect(
      ctx
        .plugin(
          { apply, inject: [...inject] },
          { enabled: true, model: "summary-provider/summary-model" },
        )
        .await(),
    ).rejects.toThrow('session-title provider "dsh-thread-summary" is already registered');

    await fiber.dispose();
    await expect(
      ctx
        .plugin(
          { apply, inject: [...inject] },
          { enabled: true, model: "summary-provider/summary-model" },
        )
        .await(),
    ).resolves.toBeDefined();
  });

  it("cancels queued automatic generation when renamed before the request header", async () => {
    const { ctx, calls, session } = await createHost();
    appendUserMessage(session, "Fix the login redirect after signing in");
    const renamed = ctx.sessionTitle.rename(session, "Pinned before generation");
    appendRequestHeader(session);
    await setImmediate();

    expect(calls).toHaveLength(0);
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionTitle.get(session)).toEqual(renamed);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe("Pinned before generation");
  });
});
