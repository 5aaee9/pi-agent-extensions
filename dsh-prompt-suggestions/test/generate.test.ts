import { describe, expect, it } from "vitest";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";

import {
  generateSuggestion,
  pickLowestEffort,
  resolveSuggestionRoute,
} from "../src/host/generate.ts";
import { SUGGESTION_INSTRUCTIONS } from "../src/host/constants.ts";
import { createLlmPlane } from "./host-plane.ts";

const route = { provider: "main", model: "model", reasoningEffort: ReasoningEffortId("low") };
const sessionId = SessionId("suggestion-test");
const noAdapter = /no adapter registered for provider "main"/u;

describe("low reasoning selection", () => {
  it("prefers low, then off/minimal, then the adapter's first level", () => {
    const info = (efforts: readonly string[]): LlmResolvedModelInfo => ({
      provider: "p",
      id: "m",
      name: "M",
      reasoning: {
        efforts: efforts.map((id) => ({ id: ReasoningEffortId(id), name: id })),
      },
    });
    expect(pickLowestEffort(info(["off", "low", "high"]))).toBe(ReasoningEffortId("low"));
    expect(pickLowestEffort(info(["off", "high"]))).toBe(ReasoningEffortId("off"));
    expect(pickLowestEffort(info(["minimal", "high"]))).toBe(ReasoningEffortId("minimal"));
    expect(pickLowestEffort(info(["high", "max"]))).toBe(ReasoningEffortId("high"));
    expect(pickLowestEffort(info([]))).toBeUndefined();
    expect(pickLowestEffort(undefined)).toBeUndefined();
  });
});

describe("suggestion request construction", () => {
  it("dispatches one tool-free low-effort call on the conversation route", async () => {
    const { ctx, calls } = await createLlmPlane();
    // There is no model credential in this environment, so the real runtime
    // stops at adapter resolution. The request it received is the assertion;
    // the streamed response is credential-gated (OpenSpec task 4.1).
    await expect(
      generateSuggestion(
        ctx.llm,
        route,
        "recent conversation",
        sessionId,
        new AbortController().signal,
      ),
    ).rejects.toThrow(noAdapter);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call).toMatchObject({
      provider: "main",
      model: "model",
      reasoningEffort: ReasoningEffortId("low"),
      system: SUGGESTION_INSTRUCTIONS,
      maxTokens: 512,
      sessionId,
    });
    expect(call.tools).toBeUndefined();
    expect(call.purpose).toBeUndefined();
    const message = call.messages[0];
    expect(message?.role).toBe("user");
    expect(message?.source).toEqual({ kind: "prompt-suggestions" });
    expect(message?.content).toEqual([{ type: "text", text: "recent conversation" }]);
  });

  it("surfaces the real adapter failure when the route has no provider", async () => {
    const { ctx } = await createLlmPlane();
    const error = await generateSuggestion(
      ctx.llm,
      { provider: "missing-provider", model: "missing-model" },
      "prompt",
      sessionId,
      new AbortController().signal,
    ).then(
      () => {
        throw new Error("expected the missing adapter to fail the call");
      },
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/no adapter registered/u);
  });

  it("stops before dispatch when the caller has already aborted", async () => {
    const { ctx, calls } = await createLlmPlane();
    const controller = new AbortController();
    controller.abort(new Error("turn changed"));
    await expect(
      generateSuggestion(ctx.llm, route, "prompt", sessionId, controller.signal),
    ).rejects.toThrow("turn changed");
    expect(calls).toHaveLength(0);
  });
});

describe("conversation route resolution", () => {
  function sessionWithRoute(provider = "main", model = "main"): Session {
    const session = Session.create(SessionId("route-test"));
    session.append("request/header", {
      reason: "initial",
      header: { config: { provider, model } },
    });
    return session;
  }

  it("reuses the logged provider and model through the real catalog", async () => {
    const { ctx } = await createLlmPlane();
    // The pinned service graph has no adapter for this route, so the real
    // capability lookup fails. A working route must still be used with the
    // adapter's own reasoning default instead of blocking generation.
    await expect(
      resolveSuggestionRoute(
        ctx.llm,
        sessionWithRoute("vendor", "big"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ provider: "vendor", model: "big" });
  });

  it("stays off before any request header and obeys cancellation", async () => {
    const { ctx, calls } = await createLlmPlane();
    await expect(
      resolveSuggestionRoute(
        ctx.llm,
        Session.create(SessionId("no-header")),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    controller.abort(new Error("turn changed"));
    await expect(
      resolveSuggestionRoute(ctx.llm, sessionWithRoute(), controller.signal),
    ).rejects.toThrow("turn changed");
    expect(calls).toHaveLength(0);
  });
});

// Credential-gated and therefore absent (OpenSpec task 4.1): delta assembly,
// reasoning suppression, finish-kind rejection, missing/tool-call/reasoning-only
// output, and the 30-second stalled-adapter deadline all need real stream
// chunks from a model route. No stream is injected in their place.
