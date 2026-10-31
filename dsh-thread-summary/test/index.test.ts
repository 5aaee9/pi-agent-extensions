import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { Session, SessionId, SessionSeq } from "@deepseek-ai/dsh-session";
import type { SessionTitleProviderRequest } from "@deepseek-ai/dsh-session-title";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSummaryPrompt,
  createTitleProvider,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_TITLE_BYTES,
  MAX_TITLE_CHARACTERS,
  normalizeTitle,
  parseModelRoute,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_TIMEOUT_MS,
} from "../index.ts";
import { createLlmPlane, LOCAL_MODEL } from "./llm-plane.ts";
import { MODEL_API_KEY, streamText } from "./model-server.ts";

/**
 * Every provider test runs the real pinned LLM plane (`llm-plane.ts`): the real
 * `LlmRuntime`, the real `@deepseek-ai/dsh-llm-pi-ai` adapter and pi-ai's real
 * OpenAI-compatible HTTP client against a locally started endpoint. The model
 * is selected through this package's own `model` setting.
 *
 * Not reachable through the real adapter, so not asserted here: the provider's
 * "did not finish" guard (pi-ai always terminates a stream with a finish chunk,
 * reporting a missing `finish_reason` as a `TRANSPORT` error, asserted below)
 * and an `aborted` finish carrying its own diagnostic (an abort of the
 * request's signal surfaces as the signal's reason before any finish chunk).
 */

function request(
  text = "Fix login",
  signal = new AbortController().signal,
): SessionTitleProviderRequest {
  return {
    session: Session.create(SessionId("summary-test")),
    messages: [{ seq: SessionSeq(7), text }],
    signal,
  };
}

function promptOf(options: GenerateOptions): string {
  return options.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

interface WireMessage {
  readonly role: string;
  readonly content: unknown;
}

function wireMessages(body: unknown): WireMessage[] {
  return (body as { messages: WireMessage[] }).messages;
}

const config = { model: LOCAL_MODEL };
/** Fake only the deadline's own clock; the HTTP client and server keep real I/O. */
const fakeClock: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout"],
};
afterEach(() => vi.useRealTimers());

describe("thread summary provider", () => {
  it("uses the configured auxiliary route and only the first source message on refresh", async () => {
    const { ctx, server, calls } = await createLlmPlane();
    server.enqueue(streamText([' "Fix login" ']));
    const provider = createTitleProvider(ctx.llm, config);
    const input = request();
    const result = await provider.generate({
      ...input,
      messages: [...input.messages, { seq: SessionSeq(9), text: "Unrelated later task" }],
    });
    expect(provider.automatic).toBe("first-prompt");
    expect(result).toEqual({
      title: "Fix login",
      messageSeqs: [7],
      model: { provider: "local", model: "summary-model" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "local",
      model: "summary-model",
      purpose: "session-title",
      sessionId: input.session.id,
      system: SUMMARY_INSTRUCTIONS,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(promptOf(calls[0]!)).toContain("Fix login");
    expect(promptOf(calls[0]!)).not.toContain("Unrelated");

    // What actually went over the wire to the endpoint.
    expect(server.requests).toHaveLength(1);
    const wire = server.requests[0]!;
    expect(wire.path).toBe("/v1/chat/completions");
    expect(wire.authorization).toBe(`Bearer ${MODEL_API_KEY}`);
    expect(wire.body).toMatchObject({
      model: "summary-model",
      stream: true,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    });
    expect(wire.body).not.toHaveProperty("tools");
    const messages = wireMessages(wire.body);
    expect(messages[0]).toEqual({ role: "system", content: SUMMARY_INSTRUCTIONS });
    expect(JSON.stringify(messages)).toContain("Fix login");
    expect(JSON.stringify(messages)).not.toContain("Unrelated");
  });

  it.each(["x", "漢", "🚀", '"\\\n\u0000'])(
    "bounds actual requests for %j without corrupting JSON or Unicode",
    async (unit) => {
      const { ctx, server, calls } = await createLlmPlane();
      server.enqueue(streamText(["Bounded title"]));
      await createTitleProvider(ctx.llm, config).generate(request(unit.repeat(200_000)));
      const options = calls[0]!;
      const prompt = promptOf(options);
      expect(Buffer.byteLength((options.system ?? "") + prompt, "utf8")).toBeLessThanOrEqual(
        MAX_INPUT_BYTES,
      );
      const decoded: unknown = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      expect(typeof decoded).toBe("string");
      expect(unit.repeat(200_000).startsWith(String(decoded))).toBe(true);
      expect(String(decoded)).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(String(decoded).length).toBeGreaterThan(0);
    },
  );

  it("reads volatile settings for each call", async () => {
    const { ctx, server, calls } = await createLlmPlane();
    let model = LOCAL_MODEL;
    let enabled = true;
    const provider = createTitleProvider(ctx.llm, {
      model: { get: () => model },
      enabled: { get: () => enabled },
    });
    server.enqueue(streamText(["First"]));
    await expect(provider.generate(request())).resolves.toMatchObject({ title: "First" });
    model = "two/other";
    await expect(provider.generate(request())).rejects.toThrow(
      'no adapter registered for provider "two"',
    );
    enabled = false;
    await expect(provider.generate(request())).rejects.toThrow("disabled");
    expect(calls.map(({ provider: route }) => route)).toEqual(["local", "two"]);
    expect(server.requests).toHaveLength(1);
  });

  it.each(["", "bad", "provider/", "/model"])(
    "rejects missing or malformed route %j before calling the model",
    async (model) => {
      const { ctx, server, calls } = await createLlmPlane();
      await expect(createTitleProvider(ctx.llm, { model }).generate(request())).rejects.toThrow(
        "not configured",
      );
      expect(calls).toHaveLength(0);
      expect(server.requests).toHaveLength(0);
    },
  );

  it("rejects empty input and already-cancelled requests before starting a stream", async () => {
    const { ctx, server, calls } = await createLlmPlane();
    const provider = createTitleProvider(ctx.llm, config);
    await expect(provider.generate(request("  "))).rejects.toThrow("no user input");
    await expect(provider.generate({ ...request(), messages: [] })).rejects.toThrow(
      "no user input",
    );
    const controller = new AbortController();
    controller.abort(new Error("user renamed"));
    await expect(provider.generate(request("hello", controller.signal))).rejects.toThrow(
      "user renamed",
    );
    expect(calls).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
  });

  it("assembles completed text blocks without duplicating deltas or exposing reasoning", async () => {
    const { ctx, server } = await createLlmPlane();
    server.enqueue((reply) => {
      reply.send({ reasoning_content: "private reasoning" });
      reply.send({ content: "Fix " });
      reply.send({ content: "login " });
      reply.send({ content: "errors" });
      reply.send({}, "stop");
      reply.done();
    });
    const result = await createTitleProvider(ctx.llm, config).generate(request());
    expect(result.title).toBe("Fix login errors");
    expect(result.title).not.toContain("private");
  });

  it.each([
    ["max-tokens", "length", { content: "Partial title" }],
    [
      "tool-calls",
      "tool_calls",
      {
        content: "Partial title",
        tool_calls: [
          { index: 0, id: "call-1", type: "function", function: { name: "x", arguments: "{}" } },
        ],
      },
    ],
  ] as const)("rejects %s even if some title text exists", async (kind, finishReason, delta) => {
    const { ctx, server } = await createLlmPlane();
    server.enqueue((reply) => {
      reply.send(delta);
      reply.send({}, finishReason);
      reply.done();
    });
    await expect(createTitleProvider(ctx.llm, config).generate(request())).rejects.toThrow(kind);
  });

  it.each([400, 500])("preserves the provider's error diagnostic for status %i", async (code) => {
    const { ctx, server } = await createLlmPlane();
    server.enqueue((reply) => {
      reply.status(code, { error: { message: "provider failed" } });
    });
    await expect(createTitleProvider(ctx.llm, config).generate(request())).rejects.toThrow(
      "provider failed",
    );
  });

  it("rejects a stream without a finish reason and reasoning-only output", async () => {
    const { ctx, server } = await createLlmPlane();
    const provider = createTitleProvider(ctx.llm, config);
    server.enqueue((reply) => {
      reply.send({ content: "incomplete" });
      reply.end();
    });
    await expect(provider.generate(request())).rejects.toThrow(
      "Stream ended without finish_reason",
    );
    server.enqueue((reply) => {
      reply.send({ reasoning_content: "thinking" });
      reply.send({}, "stop");
      reply.done();
    });
    await expect(provider.generate(request())).rejects.toThrow("empty title");
  });

  it("aborts a stalled endpoint at the deadline and closes its connection", async () => {
    const { ctx, server, calls } = await createLlmPlane();
    let stalled = (): void => {};
    const reachedStall = new Promise<void>((resolve) => {
      stalled = resolve;
    });
    server.enqueue(async (reply) => {
      reply.send({ content: "Partial" });
      stalled();
      await reply.request.closed;
    });
    vi.useFakeTimers(fakeClock);
    const result = createTitleProvider(ctx.llm, config)
      .generate(request())
      .then(
        () => ({ succeeded: true }),
        (error: unknown) => error,
      );
    await reachedStall;
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS - 1);
    const signal = calls[0]?.signal;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ code: "THREAD_SUMMARY_TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    await server.requests[0]?.closed;
    expect(server.requests[0]?.aborted()).toBe(true);
  });

  it("propagates cancellation and ignores a late successful stream", async () => {
    const { ctx, server } = await createLlmPlane();
    const controller = new AbortController();
    server.enqueue((reply) => {
      reply.send({ content: "Late title" });
      controller.abort(new Error("manual rename"));
      reply.send({}, "stop");
      reply.done();
    });
    await expect(
      createTitleProvider(ctx.llm, config).generate(request("hello", controller.signal)),
    ).rejects.toThrow("manual rename");
  });

  // The real HTTP client keeps its own keep-alive and parser timers, so a global
  // timer count says nothing about this package. A deadline that was not
  // released would still fire and abort the fused signal the provider handed to
  // the stream; a released one leaves that signal untouched past the deadline.
  async function expectReleasedDeadline(
    plane: Awaited<ReturnType<typeof createLlmPlane>>,
  ): Promise<void> {
    const signal = plane.calls[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
  }

  it("releases its deadline timer on success", async () => {
    const plane = await createLlmPlane();
    plane.server.enqueue(streamText(["Fix login"]));
    vi.useFakeTimers(fakeClock);
    await expect(
      createTitleProvider(plane.ctx.llm, config).generate(request()),
    ).resolves.toMatchObject({ title: "Fix login" });
    await expectReleasedDeadline(plane);
  });

  it("releases its deadline timer on an endpoint failure", async () => {
    const plane = await createLlmPlane();
    plane.server.enqueue((reply) => {
      reply.status(503, { error: { message: "offline" } });
    });
    vi.useFakeTimers(fakeClock);
    await expect(createTitleProvider(plane.ctx.llm, config).generate(request())).rejects.toThrow(
      "offline",
    );
    await expectReleasedDeadline(plane);
  });

  it("clears its deadline timer when no adapter serves the route", async () => {
    const { ctx } = await createLlmPlane();
    vi.useFakeTimers(fakeClock);
    await expect(
      createTitleProvider(ctx.llm, { model: "openai/gpt-4o-mini" }).generate(request()),
    ).rejects.toThrow('no adapter registered for provider "openai"');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("title normalization", () => {
  it.each([
    ["  “Fix  \n login errors!”  ", "Fix login errors"],
    ["\u001b[31m修复登录问题。\u001b[0m", "修复登录问题"],
    [".NET migration.", ".NET migration"],
    ["!important styling!", "!important styling"],
    ["''", ""],
  ])("normalizes %j", (value, expected) => expect(normalizeTitle(value)).toBe(expected));

  it.each(["a".repeat(35) + "🚀🚀", "漢".repeat(100), "🚀".repeat(100)])(
    "truncates %j at code-point and byte boundaries",
    (value) => {
      const title = normalizeTitle(value);
      expect([...title].length).toBeLessThanOrEqual(MAX_TITLE_CHARACTERS);
      expect(Buffer.byteLength(title, "utf8")).toBeLessThanOrEqual(MAX_TITLE_BYTES);
      expect(title).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(value.startsWith(title)).toBe(true);
    },
  );

  it("preserves nested model ids and trims routes", () => {
    expect(parseModelRoute(" provider / vendor/model ")).toEqual({
      provider: "provider",
      model: "vendor/model",
    });
    expect(buildSummaryPrompt("  hello  ")).toBe('User request (JSON string):\n"hello"');
  });
});
