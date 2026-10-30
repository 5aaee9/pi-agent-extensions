import { describe, expect, it } from "vitest";

import { MAX_REQUEST_BYTES } from "../src/host/constants.ts";
import { handleSuggestionRequest } from "../src/host/route.ts";
import { createEnginePlane, liveConfig } from "./host-plane.ts";

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

interface ServerEnvelope {
  type: string;
  rpcId: string;
  result:
    | { ok: true; value: { state: string; text?: string } }
    | { ok: false; error: { code: string; message: string } };
}

describe("suggestion route", () => {
  it("returns a standard server envelope for a live session", async () => {
    const { engine, session } = await createEnginePlane();
    const response = await handleSuggestionRequest(
      engine,
      request(envelope({ sessionId: session.id })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ServerEnvelope;
    expect(body).toEqual({
      type: "server-response",
      rpcId: "rpc-1",
      result: { ok: true, value: { state: "none" } },
    });
  });

  it("answers disabled when the live settings switch is off", async () => {
    const config = liveConfig(false);
    const { engine, session } = await createEnginePlane(config);
    const response = await handleSuggestionRequest(
      engine,
      request(envelope({ sessionId: session.id })),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as ServerEnvelope).toMatchObject({
      result: { ok: true, value: { state: "disabled" } },
    });
  });

  it("rejects a non-POST request and malformed transport bodies before the engine runs", async () => {
    const { ctx, engine } = await createEnginePlane();
    // A disposed Context makes the real engine throw if the route reaches it,
    // so the transport rejections prove the engine was not called.
    await ctx.fiber.dispose();
    await expect(handleSuggestionRequest(engine, request("", "GET"))).resolves.toMatchObject({
      status: 405,
    });
    await expect(handleSuggestionRequest(engine, request("not json"))).resolves.toMatchObject({
      status: 400,
    });
    const wrongMethod = new Request("http://localhost/api/prompt-suggestions/suggest", {
      method: "POST",
      body: JSON.stringify({ type: "client-request", rpcId: "1", method: "other", payload: {} }),
    });
    await expect(handleSuggestionRequest(engine, wrongMethod)).resolves.toMatchObject({
      status: 400,
    });
    const oversized = new Request("http://localhost/api/prompt-suggestions/suggest", {
      method: "POST",
      body: "x".repeat(MAX_REQUEST_BYTES + 1),
    });
    await expect(handleSuggestionRequest(engine, oversized)).resolves.toMatchObject({
      status: 413,
    });
  });

  it("returns an invalid-payload failure without calling the engine", async () => {
    const { ctx, engine } = await createEnginePlane();
    await ctx.fiber.dispose();
    const response = await handleSuggestionRequest(engine, request(envelope({ sessionId: "" })));
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
  });

  it("contains real engine failures in a Remote failure envelope", async () => {
    const { ctx, engine, session } = await createEnginePlane();
    // Disposing the real Context removes the session service the engine reads;
    // the thrown failure is the real one and must stay contained.
    await ctx.fiber.dispose();
    const response = await handleSuggestionRequest(
      engine,
      request(envelope({ sessionId: session.id })),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ServerEnvelope;
    expect(body.type).toBe("server-response");
    expect(body.rpcId).toBe("rpc-1");
    expect(body.result.ok).toBe(false);
    if (body.result.ok) throw new Error("expected a failure envelope");
    expect(body.result.error.code).toBe("prompt-suggestions/failed");
    expect(body.result.error.message.length).toBeGreaterThan(0);
  });
});
