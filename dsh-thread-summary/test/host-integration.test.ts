import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { SessionTitleService } from "@deepseek-ai/dsh-session-title";
import { describe, expect, it, onTestFinished } from "vitest";
import { apply, inject } from "../index.ts";
import { LOCAL_MODEL, mountLlmPlane } from "./llm-plane.ts";
import { streamText } from "./model-server.ts";

/**
 * Drives the real pinned Harness service graph (Cordis, SessionStore,
 * projections, AgentRegistry, SessionTitleService) and the real LLM plane
 * (`LlmRuntime` + the real `dsh-llm-pi-ai` adapter against a locally started
 * OpenAI-compatible endpoint, `llm-plane.ts`). The plugin selects that route
 * through its own `model` setting; the `llm/stream` listener only records.
 */
async function createHost(config = { enabled: true, model: LOCAL_MODEL }) {
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
  const { server, calls } = await mountLlmPlane(ctx);
  const fiber = await ctx.plugin({ apply, inject: [...inject] }, config).await();
  return { ctx, calls, server, fiber, session: ctx.sessions.create() };
}

/** Wait until `condition` holds, letting real I/O run between checks. */
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${label}`);
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
  it("generates and logs the first-prompt title after the request header, without repeating on later prompts", async () => {
    const { ctx, calls, server, session } = await createHost();
    server.enqueue(streamText([' "Fix login ', 'redirects." ']));
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
    await until(() => titleEvents(session).length === 2, "the provider title");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "local",
      model: "summary-model",
      sessionId: session.id,
      purpose: "session-title",
    });
    expect(server.requests).toHaveLength(1);
    expect(JSON.stringify(server.requests[0]?.body)).toContain(
      "Fix the login redirect after signing in",
    );
    const accepted = ctx.sessionTitle.get(session);
    expect(accepted).toMatchObject({
      title: "Fix login redirects",
      messageSeqs: [first.seq],
      source: {
        kind: "provider",
        provider: "dsh-thread-summary",
        model: { provider: "local", model: "summary-model" },
      },
    });
    expect(titleEvents(session).map((event) => event.data.source.kind)).toEqual([
      "fallback",
      "provider",
    ]);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe("Fix login redirects");

    appendUserMessage(session, "Also add regression coverage for logout");
    appendRequestHeader(session, false);
    await delay(50);
    expect(calls).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
    expect(titleEvents(session)).toHaveLength(2);
    expect(ctx.sessionTitle.get(session)).toEqual(accepted);

    const replay = Session.create(session.id, session.snapshotEvents(), session.header);
    expect(ctx.sessionTitle.get(replay)).toEqual(accepted);
    expect(ctx.sessionProjections.snapshot(replay).values.title).toBe("Fix login redirects");
  });

  it("retains the logged deterministic fallback when the summary stream fails", async () => {
    const { ctx, calls, server, session } = await createHost();
    server.enqueue((reply) => {
      reply.send({ content: "Incomplete summary" });
      reply.end();
    });
    const first = appendUserMessage(
      session,
      "Investigate intermittent connection failures in production",
    );
    appendRequestHeader(session);
    await until(() => server.requests.length === 1, "the summary request");
    await server.requests[0]?.closed;
    await delay(50);

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
    await delay(50);
    expect(calls).toHaveLength(1);
    expect(titleEvents(session)).toHaveLength(1);
  });

  it("aborts an active summary on manual rename and rejects late stream output", async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ctx, calls, server, session } = await createHost();
    // The endpoint ignores cancellation until it is released, then answers in full.
    server.enqueue(async (reply) => {
      await blocked;
      if (!reply.request.aborted()) streamText(["Fix login redirects"])(reply);
    });
    try {
      appendUserMessage(session, "Fix the login redirect after signing in");
      appendRequestHeader(session);
      await until(() => server.requests.length === 1, "the summary request");
      expect(calls).toHaveLength(1);
      const signal = calls[0]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      const renamed = ctx.sessionTitle.rename(session, "User chosen title");
      expect(signal?.aborted).toBe(true);
      expect(renamed).toMatchObject({
        title: "User chosen title",
        messageSeqs: [],
        source: { kind: "user" },
      });
      // The real client drops the connection on abort.
      await server.requests[0]?.closed;
      expect(server.requests[0]?.aborted()).toBe(true);
      release();
      await delay(50);
      expect(ctx.sessionTitle.get(session)).toEqual(renamed);
      expect(titleEvents(session).map((event) => event.data.source.kind)).toEqual([
        "fallback",
        "user",
      ]);
      expect(ctx.sessionProjections.snapshot(session).values.title).toBe("User chosen title");

      appendUserMessage(session, "Continue with another task");
      appendRequestHeader(session, false);
      await delay(50);
      expect(calls).toHaveLength(1);
      expect(ctx.sessionTitle.get(session)).toEqual(renamed);
    } finally {
      release();
    }
  });

  it("registers the sole session-title provider with the real service", async () => {
    expect(inject).toEqual(["llm", "sessionTitle"]);
    const { ctx, fiber } = await createHost();
    await expect(
      ctx.plugin({ apply, inject: [...inject] }, { enabled: true, model: LOCAL_MODEL }).await(),
    ).rejects.toThrow('session-title provider "dsh-thread-summary" is already registered');

    await fiber.dispose();
    await expect(
      ctx.plugin({ apply, inject: [...inject] }, { enabled: true, model: LOCAL_MODEL }).await(),
    ).resolves.toBeDefined();
  });

  it("cancels queued automatic generation when renamed before the request header", async () => {
    const { ctx, calls, server, session } = await createHost();
    appendUserMessage(session, "Fix the login redirect after signing in");
    const renamed = ctx.sessionTitle.rename(session, "Pinned before generation");
    appendRequestHeader(session);
    await delay(50);

    expect(calls).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
    expect(titleEvents(session)).toHaveLength(1);
    expect(ctx.sessionTitle.get(session)).toEqual(renamed);
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe("Pinned before generation");
  });
});
