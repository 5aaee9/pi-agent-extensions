import { describe, expect, it } from "vitest";

import { turnHasPredictionInput } from "../src/host/engine.ts";
import {
  addAssistant,
  addRequestHeader,
  addUser,
  createHostPlane,
  endTurn,
  flush,
  liveConfig,
  promptOf,
  querySuggestion,
  setLiveEnabled,
  startTurn,
} from "./host-plane.ts";

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
  it("requests one auxiliary call for a watched completed turn without writing the session", async () => {
    const { session, routes, calls } = await createHostPlane();
    addRequestHeader(session);
    startTurn(session, 1);
    // The first empty-composer query marks the session watched while the turn
    // is still running, so the completion can generate without another query.
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Fix the login redirect");
    addAssistant(session, "Updated the redirect and added a test.");
    endTurn(session, 1);
    const before = session.snapshotEvents().length;
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "main-provider",
      model: "main-model",
      sessionId: session.id,
      maxTokens: 512,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(calls[0]?.purpose).toBeUndefined();
    const prompt = promptOf(calls[0]!);
    expect(prompt).toContain("Fix the login redirect");
    expect(prompt).toContain("Updated the redirect");
    expect(session.snapshotEvents()).toHaveLength(before);

    // The real runtime has no adapter for the route, so the request fails at
    // the provider seam and the reply stays empty. Asserting the ready text
    // needs a live model credential and is recorded as task 4.1, not faked.
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(session.snapshotEvents()).toHaveLength(before);
  });

  it("does not generate for failed, interrupted, or text-free turns", async () => {
    const { session, routes, calls } = await createHostPlane();
    addRequestHeader(session);
    await querySuggestion(routes, session.id);
    startTurn(session, 1);
    addUser(session, "One");
    addAssistant(session, "Done");
    endTurn(session, 1, "error");
    startTurn(session, 2);
    addUser(session, "Two");
    endTurn(session, 2);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
  });

  it("does not generate for a replayed completed turn before the session is watched", async () => {
    const { session, routes, calls } = await createHostPlane();
    addRequestHeader(session);
    startTurn(session, 1);
    addUser(session, "Summarize the diff");
    addAssistant(session, "The diff changes three files.");
    endTurn(session, 1);
    expect(calls).toHaveLength(0);

    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
  });

  it("uses at most eight recent turns in the auxiliary prompt", async () => {
    const { session, routes, calls } = await createHostPlane();
    addRequestHeader(session);
    for (let turn = 1; turn <= 9; turn += 1) {
      startTurn(session, turn);
      addUser(session, `question ${turn}`);
      addAssistant(session, `answer ${turn}`, turn);
      endTurn(session, turn);
    }
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    startTurn(session, 10);
    addUser(session, "question 10");
    addAssistant(session, "answer 10", 10);
    endTurn(session, 10);
    await flush();
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
    // The real adapter is missing, so this completed turn also answers none;
    // the ready reply is credential-gated (task 4.1).
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
  });

  it("honors the live enabled switch the Host settings plane writes", async () => {
    const config = liveConfig(true);
    const { session, routes, calls } = await createHostPlane(config);
    setLiveEnabled(config, false);
    addRequestHeader(session);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "disabled" });

    setLiveEnabled(config, true);
    startTurn(session, 2);
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Continue");
    addAssistant(session, "Continued", 2);
    endTurn(session, 2);
    await flush();
    expect(calls).toHaveLength(1);
    // Ready output needs a live model (task 4.1); the real missing adapter
    // leaves the state empty rather than inventing a suggestion.
    await expect(querySuggestion(routes, session.id)).resolves.toEqual({ state: "none" });
  });
});

// Credential-gated and therefore absent from this file (OpenSpec task 4.1):
// - the suggested text for a completed turn, which needs a real model response;
// - low-effort selection through a real adapter's advertised effort list;
// - cancelling an in-flight model call on query abort or a new turn, which
//   needs a stream that stays open long enough to cancel.
// The real runtime, session store, settings reference, and request construction
// above are not replaced; only the provider's response is unavailable.
