import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { ReasoningEffortId, ToolCallId } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";

import {
  generateSuggestion,
  pickLowestEffort,
  resolveSuggestionRoute,
} from "../src/host/generate.ts";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_TIMEOUT_MS } from "../src/host/constants.ts";

type Stream = (options: GenerateOptions) => AsyncIterable<StreamChunk>;

function mockLlm(chunks: readonly StreamChunk[] = successful()) {
  const calls: GenerateOptions[] = [];
  const llm = {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options);
      yield* chunks;
    },
  };
  return { llm, calls };
}

function successful(): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: ' "Add a test" ' },
    { type: "block-end", index: 0, block: { type: "text", text: ' "Add a test" ' } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

const route = { provider: "main", model: "model", reasoningEffort: ReasoningEffortId("low") };
const sessionId = SessionId("suggestion-test");

afterEach(() => vi.useRealTimers());

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

describe("suggestion request", () => {
  it("streams one tool-free low-effort call on the conversation route", async () => {
    const { llm, calls } = mockLlm();
    const text = await generateSuggestion(
      llm,
      route,
      "recent conversation",
      sessionId,
      new AbortController().signal,
    );
    expect(text).toBe("Add a test");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "main",
      model: "model",
      reasoningEffort: ReasoningEffortId("low"),
      system: SUGGESTION_INSTRUCTIONS,
      maxTokens: 512,
      sessionId,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(calls[0]?.purpose).toBeUndefined();
    const message = calls[0]?.messages[0];
    expect(message?.role).toBe("user");
    expect(message?.source).toEqual({ kind: "prompt-suggestions" });
    expect(message?.content).toEqual([{ type: "text", text: "recent conversation" }]);
  });

  it("assembles deltas and ignores reasoning", async () => {
    const { llm } = mockLlm([
      { type: "reasoning-delta", index: 0, text: "private" },
      { type: "text-delta", index: 1, text: "Add " },
      { type: "text-delta", index: 1, text: "coverage" },
      { type: "block-end", index: 1, block: { type: "text", text: "Add coverage" } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    await expect(
      generateSuggestion(llm, route, "prompt", sessionId, new AbortController().signal),
    ).resolves.toBe("Add coverage");
  });

  it.each(["tool-calls", "max-tokens"] as const)(
    "rejects a %s finish even when text exists",
    async (kind) => {
      const { llm } = mockLlm([
        { type: "text-delta", index: 0, text: "Partial" },
        { type: "finish", reason: { kind } },
      ]);
      await expect(
        generateSuggestion(llm, route, "prompt", sessionId, new AbortController().signal),
      ).rejects.toThrow(kind);
    },
  );

  it.each(["error", "aborted"] as const)("preserves the %s diagnostic", async (kind) => {
    const { llm } = mockLlm([
      {
        type: "finish",
        reason: { kind, failure: { code: "FAILED", message: "provider unavailable" } },
      },
    ]);
    await expect(
      generateSuggestion(llm, route, "prompt", sessionId, new AbortController().signal),
    ).rejects.toThrow("provider unavailable");
  });

  it("rejects a missing finish, a tool-call response, and reasoning-only output", async () => {
    await expect(
      generateSuggestion(
        mockLlm([{ type: "text-delta", index: 0, text: "incomplete" }]).llm,
        route,
        "prompt",
        sessionId,
        new AbortController().signal,
      ),
    ).rejects.toThrow("did not finish");

    await expect(
      generateSuggestion(
        mockLlm([
          { type: "text-delta", index: 0, text: "I will run it" },
          {
            type: "tool-call-delta",
            index: 1,
            id: ToolCallId("call-1"),
            name: "bash",
            argumentsDelta: "{}",
          },
          {
            type: "block-end",
            index: 1,
            block: { type: "tool-call", id: ToolCallId("call-1"), name: "bash", arguments: "{}" },
          },
          { type: "finish", reason: { kind: "stop" } },
        ]).llm,
        route,
        "prompt",
        sessionId,
        new AbortController().signal,
      ),
    ).resolves.toBe("");

    await expect(
      generateSuggestion(
        mockLlm([
          { type: "reasoning-delta", index: 0, text: "thinking" },
          { type: "finish", reason: { kind: "stop" } },
        ]).llm,
        route,
        "prompt",
        sessionId,
        new AbortController().signal,
      ),
    ).resolves.toBe("");
  });

  it("aborts a stalled adapter at 30 seconds and clears the deadline timer", async () => {
    vi.useFakeTimers();
    const stalled: Stream = async function* (options): AsyncGenerator<StreamChunk> {
      await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
      yield* [] as StreamChunk[];
    };
    const promise = generateSuggestion(
      { stream: stalled },
      route,
      "prompt",
      sessionId,
      new AbortController().signal,
    );
    const rejection = promise.then(
      () => {
        throw new Error("expected the stalled call to time out");
      },
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(SUGGESTION_TIMEOUT_MS);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/PROMPT_SUGGESTIONS_TIMEOUT|timeout/iu);
    expect(vi.getTimerCount()).toBe(0);
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

  const info = (efforts: readonly string[]): LlmResolvedModelInfo => ({
    provider: "main",
    id: "main",
    name: "Main",
    reasoning: {
      efforts: efforts.map((id) => ({ id: ReasoningEffortId(id), name: id })),
    },
  });

  it("reuses the logged provider/model and selects low effort", async () => {
    const resolveModelInfo = vi.fn<Pick<Context["llm"], "resolveModelInfo">["resolveModelInfo"]>(
      async () => info(["off", "low", "high"]),
    );
    const llm = { resolveModelInfo } as unknown as Pick<Context["llm"], "resolveModelInfo">;
    await expect(
      resolveSuggestionRoute(llm, sessionWithRoute("vendor", "big"), new AbortController().signal),
    ).resolves.toEqual({
      provider: "vendor",
      model: "big",
      reasoningEffort: ReasoningEffortId("low"),
    });
    expect(resolveModelInfo).toHaveBeenCalledWith("vendor", "big", expect.any(AbortSignal));
  });

  it("keeps the working route when capability lookup fails", async () => {
    const llm = {
      resolveModelInfo: vi.fn<Pick<Context["llm"], "resolveModelInfo">["resolveModelInfo"]>(
        async () => {
          throw new Error("catalog offline");
        },
      ),
    } as unknown as Pick<Context["llm"], "resolveModelInfo">;
    await expect(
      resolveSuggestionRoute(llm, sessionWithRoute(), new AbortController().signal),
    ).resolves.toEqual({ provider: "main", model: "main" });
  });

  it("stays off before any request header and obeys cancellation", async () => {
    const session = Session.create(SessionId("no-header"));
    const llm = {
      resolveModelInfo: vi.fn<Pick<Context["llm"], "resolveModelInfo">["resolveModelInfo"]>(),
    } as unknown as Pick<Context["llm"], "resolveModelInfo">;
    await expect(
      resolveSuggestionRoute(llm, session, new AbortController().signal),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    controller.abort(new Error("turn changed"));
    await expect(
      resolveSuggestionRoute(llm, sessionWithRoute(), controller.signal),
    ).rejects.toThrow("turn changed");
  });
});
