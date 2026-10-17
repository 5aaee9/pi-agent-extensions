import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Session, SessionId, SessionSeq } from "@deepseek-ai/dsh-session";
import type { SessionTitleProviderRequest } from "@deepseek-ai/dsh-session-title";
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

function mockLlm(
  chunks: readonly StreamChunk[] = [
    { type: "text-delta", index: 0, text: ' "Fix login" ' },
    { type: "finish", reason: { kind: "stop" } },
  ],
) {
  const calls: GenerateOptions[] = [];
  return {
    calls,
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options);
      yield* chunks;
    },
  };
}

function promptOf(options: GenerateOptions): string {
  return options.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const config = { model: "openai/gpt-4o-mini" };
afterEach(() => vi.useRealTimers());

describe("thread summary provider", () => {
  it("uses the configured auxiliary route and only the first source message on refresh", async () => {
    const llm = mockLlm();
    const provider = createTitleProvider(llm, config);
    const input = request();
    const result = await provider.generate({
      ...input,
      messages: [...input.messages, { seq: SessionSeq(9), text: "Unrelated later task" }],
    });
    expect(provider.automatic).toBe("first-prompt");
    expect(result).toEqual({
      title: "Fix login",
      messageSeqs: [7],
      model: { provider: "openai", model: "gpt-4o-mini" },
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      purpose: "session-title",
      sessionId: input.session.id,
      system: SUMMARY_INSTRUCTIONS,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    expect(llm.calls[0]?.tools).toBeUndefined();
    expect(promptOf(llm.calls[0]!)).toContain("Fix login");
    expect(promptOf(llm.calls[0]!)).not.toContain("Unrelated");
  });

  it.each(["x", "漢", "🚀", '"\\\n\u0000'])(
    "bounds actual requests for %j without corrupting JSON or Unicode",
    async (unit) => {
      const llm = mockLlm();
      await createTitleProvider(llm, config).generate(request(unit.repeat(200_000)));
      const options = llm.calls[0]!;
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
    const llm = mockLlm();
    let model = "one/model";
    let enabled = true;
    const provider = createTitleProvider(llm, {
      model: { get: () => model },
      enabled: { get: () => enabled },
    });
    await provider.generate(request());
    model = "two/other";
    await provider.generate(request());
    enabled = false;
    await expect(provider.generate(request())).rejects.toThrow("disabled");
    expect(llm.calls.map(({ provider: route }) => route)).toEqual(["one", "two"]);
  });

  it.each(["", "bad", "provider/", "/model"])(
    "rejects missing or malformed route %j before calling the model",
    async (model) => {
      const llm = mockLlm();
      await expect(createTitleProvider(llm, { model }).generate(request())).rejects.toThrow(
        "not configured",
      );
      expect(llm.calls).toHaveLength(0);
    },
  );

  it("rejects empty input and already-cancelled requests before starting a stream", async () => {
    const llm = mockLlm();
    const provider = createTitleProvider(llm, config);
    await expect(provider.generate(request("  "))).rejects.toThrow("no user input");
    await expect(provider.generate({ ...request(), messages: [] })).rejects.toThrow(
      "no user input",
    );
    const controller = new AbortController();
    controller.abort(new Error("user renamed"));
    await expect(provider.generate(request("hello", controller.signal))).rejects.toThrow(
      "user renamed",
    );
    expect(llm.calls).toHaveLength(0);
  });

  it("assembles completed text blocks without duplicating deltas or exposing reasoning", async () => {
    const llm = mockLlm([
      { type: "reasoning-delta", index: 0, text: "private reasoning" },
      { type: "text-delta", index: 1, text: "Fix " },
      { type: "text-delta", index: 1, text: "login" },
      { type: "block-end", index: 1, block: { type: "text", text: "Fix login" } },
      { type: "block-end", index: 2, block: { type: "text", text: "errors" } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    expect((await createTitleProvider(llm, config).generate(request())).title).toBe(
      "Fix login errors",
    );
  });

  it.each(["max-tokens", "tool-calls"] as const)(
    "rejects %s even if some title text exists",
    async (kind) => {
      const llm = mockLlm([
        { type: "text-delta", index: 0, text: "Partial title" },
        { type: "finish", reason: { kind } },
      ]);
      await expect(createTitleProvider(llm, config).generate(request())).rejects.toThrow(kind);
    },
  );

  it.each(["error", "aborted"] as const)("preserves the %s diagnostic", async (kind) => {
    const llm = mockLlm([
      { type: "finish", reason: { kind, failure: { code: "FAILED", message: "provider failed" } } },
    ]);
    await expect(createTitleProvider(llm, config).generate(request())).rejects.toThrow(
      "provider failed",
    );
  });

  it("rejects missing completion and reasoning-only output", async () => {
    await expect(
      createTitleProvider(
        mockLlm([{ type: "text-delta", index: 0, text: "incomplete" }]),
        config,
      ).generate(request()),
    ).rejects.toThrow("did not finish");
    await expect(
      createTitleProvider(
        mockLlm([
          { type: "reasoning-delta", index: 0, text: "thinking" },
          { type: "finish", reason: { kind: "stop" } },
        ]),
        config,
      ).generate(request()),
    ).rejects.toThrow("empty title");
  });

  it("aborts a stalled adapter at the deadline and releases its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const provider = createTitleProvider(
      {
        async *stream(options): AsyncIterable<StreamChunk> {
          signal = options.signal;
          yield { type: "text-delta", index: 0, text: "Partial" };
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
          });
        },
      },
      config,
    );
    const result = provider.generate(request()).then(
      () => ({ succeeded: true }),
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ code: "THREAD_SUMMARY_TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates cancellation and ignores a late successful stream", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const provider = createTitleProvider(
      {
        async *stream(): AsyncIterable<StreamChunk> {
          yield { type: "text-delta", index: 0, text: "Late title" };
          controller.abort(new Error("manual rename"));
          yield { type: "finish", reason: { kind: "stop" } };
        },
      },
      config,
    );
    await expect(provider.generate(request("hello", controller.signal))).rejects.toThrow(
      "manual rename",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears deadline timers on success and provider failure", async () => {
    vi.useFakeTimers();
    await createTitleProvider(mockLlm(), config).generate(request());
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      createTitleProvider(
        {
          async *stream(): AsyncIterable<StreamChunk> {
            yield { type: "text-delta", index: 0, text: "Partial" };
            throw new Error("offline");
          },
        },
        config,
      ).generate(request()),
    ).rejects.toThrow("offline");
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
