import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";

import {
  generateSuggestion,
  pickLowestEffort,
  resolveSuggestionRoute,
} from "../src/host/generate.ts";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_TIMEOUT_MS } from "../src/host/constants.ts";
import { createLlmPlane, LOCAL_KEY, MODEL, PLAIN_MODEL, PROVIDER, until } from "./host-plane.ts";
import { replyText, type Responder } from "./model-server.ts";

const route = { provider: PROVIDER, model: MODEL, reasoningEffort: ReasoningEffortId("low") };
const sessionId = SessionId("suggestion-test");

afterEach(() => vi.useRealTimers());

function run(llm: Parameters<typeof generateSuggestion>[0], signal = new AbortController().signal) {
  return generateSuggestion(llm, route, "prompt", sessionId, signal);
}

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

describe("suggestion request through the real adapter and a local endpoint", () => {
  it("streams one tool-free low-effort call on the conversation route", async () => {
    const { ctx, calls, server } = await createLlmPlane(replyText(' "Add a test" '));
    const text = await generateSuggestion(
      ctx.llm,
      route,
      "recent conversation",
      sessionId,
      new AbortController().signal,
    );
    expect(text).toBe("Add a test");

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call).toMatchObject({
      provider: PROVIDER,
      model: MODEL,
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

    // What actually went over the wire, as the real pi-ai client serialized it.
    expect(server.requests).toHaveLength(1);
    const wire = server.requests[0]!;
    expect(wire.path).toBe("/v1/chat/completions");
    expect(wire.headers.authorization).toBe(`Bearer ${LOCAL_KEY}`);
    expect(wire.body).toMatchObject({
      model: MODEL,
      stream: true,
      max_completion_tokens: 512,
      reasoning_effort: "low",
    });
    expect(wire.body["tools"]).toBeUndefined();
    // The instructions travel as the adapter's own instruction role (pi-ai picks
    // `developer` for a reasoning model), followed by the framed conversation.
    const messages = wire.body["messages"] as { role: string; content: unknown }[];
    expect(messages).toHaveLength(2);
    expect(["system", "developer"]).toContain(messages[0]?.role);
    expect(messages[0]?.content).toBe(SUGGESTION_INSTRUCTIONS);
    expect(messages[1]).toEqual({ role: "user", content: "recent conversation" });
  });

  it("assembles deltas and ignores reasoning", async () => {
    const { ctx } = await createLlmPlane((exchange) => {
      exchange.chunk({ role: "assistant", reasoning_content: "private" });
      exchange.chunk({ content: "Add " });
      exchange.chunk({ content: "coverage" });
      exchange.chunk({}, "stop");
      exchange.done();
    });
    await expect(run(ctx.llm)).resolves.toBe("Add coverage");
  });

  it.each([
    ["length", "max-tokens"],
    ["tool_calls", "tool-calls"],
  ] as const)("rejects a %s finish even when text exists", async (wire, kind) => {
    const { ctx } = await createLlmPlane((exchange) => {
      exchange.chunk({ role: "assistant", content: "Partial" });
      exchange.chunk({}, wire);
      exchange.done();
    });
    await expect(run(ctx.llm)).rejects.toThrow(kind);
  });

  it("preserves the provider's error diagnostic", async () => {
    const { ctx } = await createLlmPlane((exchange) => {
      exchange.chunk({ role: "assistant", content: "Partial" });
      exchange.chunk({}, "content_filter");
      exchange.done();
    });
    await expect(run(ctx.llm)).rejects.toThrow("content_filter");
  });

  it("surfaces an endpoint failure status", async () => {
    const { ctx } = await createLlmPlane((exchange) => {
      exchange.fail(503, "provider unavailable");
    });
    await expect(run(ctx.llm)).rejects.toThrow("provider unavailable");
  });

  it("rejects a stream that ends without a finish", async () => {
    const { ctx } = await createLlmPlane((exchange) => {
      exchange.chunk({ role: "assistant", content: "incomplete" });
      exchange.end();
    });
    // The real adapter turns a truncated wire stream into an error finish, so the
    // diagnostic it names is what the suggestion fails with.
    await expect(run(ctx.llm)).rejects.toThrow("without finish_reason");
  });

  it("rejects a tool-call response and reasoning-only output as empty suggestions", async () => {
    const toolCall: Responder = (exchange) => {
      exchange.chunk({ role: "assistant", content: "I will run it" });
      exchange.chunk({
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "bash", arguments: "{}" },
          },
        ],
      });
      exchange.chunk({}, "stop");
      exchange.done();
    };
    const tool = await createLlmPlane(toolCall);
    await expect(run(tool.ctx.llm)).resolves.toBe("");

    const reasoning = await createLlmPlane((exchange) => {
      exchange.chunk({ role: "assistant", reasoning_content: "thinking" });
      exchange.chunk({}, "stop");
      exchange.done();
    });
    await expect(run(reasoning.ctx.llm)).resolves.toBe("");
  });

  it("aborts the wire request when the caller cancels mid-stream", async () => {
    let closed: Promise<void> | undefined;
    const { ctx, server } = await createLlmPlane((exchange) => {
      closed = exchange.closed;
      exchange.chunk({ role: "assistant", content: "Add" });
    });
    const controller = new AbortController();
    const pending = run(ctx.llm, controller.signal);
    await until(() => server.requests.length === 1 && closed !== undefined, "the request");
    controller.abort(new Error("turn changed"));
    await expect(pending).rejects.toThrow("turn changed");
    await closed;
  });

  it("aborts a stalled endpoint at 30 seconds and clears the deadline timer", async () => {
    let closed: Promise<void> | undefined;
    const { ctx, server } = await createLlmPlane((exchange) => {
      // Accept the request and then say nothing: a stalled provider.
      closed = exchange.closed;
      exchange.chunk({ role: "assistant" });
    });
    // Only the deadline's own timer kinds are faked; the network stays real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rejection = run(ctx.llm).then(
      () => {
        throw new Error("expected the stalled call to time out");
      },
      (error: unknown) => error,
    );
    await until(() => server.requests.length === 1 && closed !== undefined, "the request");
    await vi.advanceTimersByTimeAsync(SUGGESTION_TIMEOUT_MS);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/PROMPT_SUGGESTIONS_TIMEOUT|timeout/iu);
    // The deadline reached the wire: the real client hung up on the endpoint.
    await closed;
  });

  it("stops before dispatch when the caller has already aborted", async () => {
    const { ctx, calls, server } = await createLlmPlane();
    const controller = new AbortController();
    controller.abort(new Error("turn changed"));
    await expect(run(ctx.llm, controller.signal)).rejects.toThrow("turn changed");
    expect(calls).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces the real adapter failure when the route has no provider", async () => {
    const { ctx } = await createLlmPlane();
    await expect(
      generateSuggestion(
        ctx.llm,
        { provider: "missing-provider", model: "missing-model" },
        "prompt",
        sessionId,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no adapter registered/u);
  });
});

describe("conversation route resolution", () => {
  function sessionWithRoute(provider = PROVIDER, model = MODEL): Session {
    const session = Session.create(SessionId("route-test"));
    session.append("request/header", {
      reason: "initial",
      header: { config: { provider, model } },
    });
    return session;
  }

  it("reuses the logged provider/model and selects low effort from the real catalog", async () => {
    const { ctx } = await createLlmPlane();
    await expect(
      resolveSuggestionRoute(ctx.llm, sessionWithRoute(), new AbortController().signal),
    ).resolves.toEqual({
      provider: PROVIDER,
      model: MODEL,
      reasoningEffort: ReasoningEffortId("low"),
    });
  });

  it("leaves the adapter default for a model that advertises no reasoning", async () => {
    const { ctx } = await createLlmPlane();
    await expect(
      resolveSuggestionRoute(
        ctx.llm,
        sessionWithRoute(PROVIDER, PLAIN_MODEL),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ provider: PROVIDER, model: PLAIN_MODEL, reasoningEffort: undefined });
  });

  it("keeps the working route when the real capability lookup fails", async () => {
    const { ctx } = await createLlmPlane();
    // No adapter serves "vendor", so the real catalog lookup throws; the route
    // must still be used with the adapter's own reasoning default.
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
