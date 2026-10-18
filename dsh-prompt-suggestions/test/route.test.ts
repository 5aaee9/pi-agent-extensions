import { describe, expect, it, vi } from "vitest";

import type { SuggestionEngine, SuggestionReply } from "../src/host/engine.ts";
import { handleSuggestionRequest } from "../src/host/route.ts";
import { MAX_REQUEST_BYTES } from "../src/host/constants.ts";

function engine(reply: SuggestionReply = { state: "ready", text: "Add a test" }): SuggestionEngine {
  return {
    request: vi.fn<SuggestionEngine["request"]>(async () => reply),
  } as unknown as SuggestionEngine;
}

function envelope(payload: unknown = { sessionId: "session-1" }, rpcId = "rpc-1"): string {
  return JSON.stringify({
    type: "client-request",
    rpcId,
    method: "prompt-suggestions/suggest",
    payload,
  });
}

function request(body = envelope(), method = "POST"): Request {
  return new Request("http://localhost/api/prompt-suggestions/suggest", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body } : {}),
  });
}

describe("suggestion route", () => {
  it("returns a standard server envelope for a valid query", async () => {
    const fake = engine();
    const response = await handleSuggestionRequest(fake, request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      type: "server-response",
      rpcId: "rpc-1",
      result: { ok: true, value: { state: "ready", text: "Add a test" } },
    });
    expect(fake.request).toHaveBeenCalledWith("session-1", expect.any(AbortSignal));
  });

  it("rejects a non-POST request and malformed transport bodies", async () => {
    await expect(handleSuggestionRequest(engine(), request("", "GET"))).resolves.toMatchObject({
      status: 405,
    });
    await expect(handleSuggestionRequest(engine(), request("not json"))).resolves.toMatchObject({
      status: 400,
    });
    const wrongMethod = new Request("http://localhost/api/prompt-suggestions/suggest", {
      method: "POST",
      body: JSON.stringify({ type: "client-request", rpcId: "1", method: "other", payload: {} }),
    });
    await expect(handleSuggestionRequest(engine(), wrongMethod)).resolves.toMatchObject({
      status: 400,
    });
    const oversized = new Request("http://localhost/api/prompt-suggestions/suggest", {
      method: "POST",
      body: "x".repeat(MAX_REQUEST_BYTES + 1),
    });
    await expect(handleSuggestionRequest(engine(), oversized)).resolves.toMatchObject({
      status: 413,
    });
  });

  it("returns an invalid-payload failure without calling the engine", async () => {
    const fake = engine();
    const response = await handleSuggestionRequest(fake, request(envelope({ sessionId: "" })));
    await expect(response.json()).resolves.toEqual({
      type: "server-response",
      rpcId: "rpc-1",
      result: {
        ok: false,
        error: {
          code: "prompt-suggestions/bad-request",
          message: "sessionId must be a non-empty string",
          details: {},
        },
      },
    });
    expect(fake.request).not.toHaveBeenCalled();
  });

  it("contains engine failures in a Remote failure envelope", async () => {
    const fake = {
      request: vi.fn<SuggestionEngine["request"]>(async () => {
        throw new Error("engine exploded");
      }),
    } as unknown as SuggestionEngine;
    const response = await handleSuggestionRequest(fake, request());
    await expect(response.json()).resolves.toMatchObject({
      result: {
        ok: false,
        error: { code: "prompt-suggestions/failed", message: "engine exploded" },
      },
    });
  });
});
