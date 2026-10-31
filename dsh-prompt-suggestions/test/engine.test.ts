import { describe, expect, it } from "vitest";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";

import { turnHasPredictionInput } from "../src/host/engine.ts";
import {
  addAssistant,
  addRequestHeader,
  addUser,
  createHostPlane,
  endTurn,
  flush,
  liveConfig,
  MODEL,
  promptOf,
  PROVIDER,
  setLiveEnabled,
  startTurn,
  until,
} from "./host-plane.ts";
import type { Exchange, Responder } from "./model-server.ts";

/** A responder that holds each request open until the test releases it. */
function held(): { responder: Responder; exchanges: Exchange[] } {
  const exchanges: Exchange[] = [];
  return {
    exchanges,
    responder: (exchange) => {
      exchanges.push(exchange);
      exchange.chunk({ role: "assistant" });
    },
  };
}

describe("turn input helpers", () => {
  it("requires direct human input and visible assistant text", async () => {
    const { session } = await createHostPlane();
    addRequestHeader(session);
    startTurn(session, 1);
    expect(turnHasPredictionInput(session, 1)).toBe(false);
    addUser(session, "Fix login");
    expect(turnHasPredictionInput(session, 1)).toBe(false);
    addAssistant(session, "Fixed");
    expect(turnHasPredictionInput(session, 1)).toBe(true);
  });
});

describe("suggestion engine with the real Harness service graph", () => {
  it("generates one low-effort suggestion for a watched completed turn without writing the session", async () => {
    const { session, query, calls, server } = await createHostPlane();
    addRequestHeader(session);
    startTurn(session, 1);
    // The first empty-composer query marks the session watched while the turn
    // is still running, so the completion can generate without another query.
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Fix the login redirect");
    addAssistant(session, "Updated the redirect and added a test.");
    endTurn(session, 1);
    const before = session.snapshotEvents().length;

    // The query waits on the in-flight generation and answers its real result.
    await expect(query(session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: PROVIDER,
      model: MODEL,
      reasoningEffort: ReasoningEffortId("low"),
      sessionId: session.id,
      maxTokens: 512,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(calls[0]?.purpose).toBeUndefined();
    const prompt = promptOf(calls[0]!);
    expect(prompt).toContain("Fix the login redirect");
    expect(prompt).toContain("Updated the redirect");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body["reasoning_effort"]).toBe("low");
    expect(session.snapshotEvents()).toHaveLength(before);
  });

  it("answers none when the real model call fails", async () => {
    const { session, query, server } = await createHostPlane(liveConfig(), {
      responder: (exchange) => exchange.fail(500, "local failure"),
    });
    addRequestHeader(session);
    await query(session.id);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed");
    endTurn(session, 1);
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    expect(server.requests).toHaveLength(1);
  });

  it("does not generate for failed, interrupted, or text-free turns", async () => {
    const { session, query, calls } = await createHostPlane();
    addRequestHeader(session);
    await query(session.id);
    startTurn(session, 1);
    addUser(session, "One");
    addAssistant(session, "Done");
    endTurn(session, 1, "error");
    startTurn(session, 2);
    addUser(session, "Two");
    endTurn(session, 2);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
  });

  it("does not generate for a replayed completed turn before the session is watched", async () => {
    const { session, query, calls } = await createHostPlane();
    addRequestHeader(session);
    startTurn(session, 1);
    addUser(session, "Summarize the diff");
    addAssistant(session, "The diff changes three files.");
    endTurn(session, 1);
    expect(calls).toHaveLength(0);

    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
  });

  it("uses at most eight recent turns in the auxiliary prompt", async () => {
    const { session, query, calls } = await createHostPlane();
    addRequestHeader(session);
    for (let turn = 1; turn <= 9; turn += 1) {
      startTurn(session, turn);
      addUser(session, `question ${turn}`);
      addAssistant(session, `answer ${turn}`, turn);
      endTurn(session, turn);
    }
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    startTurn(session, 10);
    addUser(session, "question 10");
    addAssistant(session, "answer 10", 10);
    endTurn(session, 10);
    await expect(query(session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(calls).toHaveLength(1);
    const prompt = promptOf(calls[0]!);
    const framed = prompt.slice(prompt.indexOf("\n") + 1);
    const decoded = JSON.parse(framed) as { user: string }[];
    expect(decoded.map((item) => item.user)).toEqual([
      "question 3",
      "question 4",
      "question 5",
      "question 6",
      "question 7",
      "question 8",
      "question 9",
      "question 10",
    ]);
  });

  it("cancels an in-flight suggestion when its query is aborted", async () => {
    const hold = held();
    const { session, query, calls } = await createHostPlane(liveConfig(), {
      responder: hold.responder,
    });
    addRequestHeader(session);
    await query(session.id);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await until(() => hold.exchanges.length === 1, "the held model request");
    expect(calls).toHaveLength(1);
    const generationSignal = calls[0]?.signal;
    expect(generationSignal?.aborted).toBe(false);

    const controller = new AbortController();
    const pending = query(session.id, controller.signal);
    await flush();
    controller.abort();
    await expect(pending).resolves.toEqual({ state: "none" });
    expect(generationSignal?.aborted).toBe(true);
    // The cancellation reached the wire: the real client hung up.
    await hold.exchanges[0]?.closed;
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(1);
  });

  it("aborts an in-flight suggestion when a new turn starts", async () => {
    const hold = held();
    const { session, query, calls } = await createHostPlane(liveConfig(), {
      responder: hold.responder,
    });
    addRequestHeader(session);
    await query(session.id);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await until(() => hold.exchanges.length === 1, "the held model request");
    const signal = calls[0]?.signal;
    expect(signal?.aborted).toBe(false);

    startTurn(session, 2);
    expect(signal?.aborted).toBe(true);
    await hold.exchanges[0]?.closed;
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(1);
  });

  it("honors the live enabled switch the Host settings plane writes", async () => {
    const config = liveConfig(true);
    const { session, query, calls } = await createHostPlane(config);
    setLiveEnabled(config, false);
    addRequestHeader(session);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(query(session.id)).resolves.toEqual({ state: "disabled" });

    setLiveEnabled(config, true);
    startTurn(session, 2);
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Continue");
    addAssistant(session, "Continued", 2);
    endTurn(session, 2);
    await expect(query(session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(calls).toHaveLength(1);
  });

  it("registers its route on the real Connection service and removes it on unload", async () => {
    const { session, query, plugin, dispatch } = await createHostPlane();
    await expect(query(session.id)).resolves.toEqual({ state: "none" });
    await plugin.dispose();
    // With the plugin unloaded the real shared handler no longer routes the path.
    const response = await dispatch(
      new Request("http://localhost/api/prompt-suggestions/suggest", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(404);
  });
});
