import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Session, SessionId, SessionSeq } from "@deepseek-ai/dsh-session";
import type { SessionTitleProviderRequest } from "@deepseek-ai/dsh-session-title";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
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

/**
 * Mount the real pinned LLM service and observe the real `llm/stream` waterfall.
 * The listener delegates to the real adapter dispatch, so it records exactly the
 * request the provider built without replacing the stream or its outcome.
 */
async function createLlm() {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(LlmRuntime).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  return { llm: ctx.llm, calls };
}

function promptOf(options: GenerateOptions): string {
  return options.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const noAdapter = 'no adapter registered for provider "openai"';
const config = { model: "openai/gpt-4o-mini" };
afterEach(() => vi.useRealTimers());

describe("thread summary provider", () => {
  it("uses the configured auxiliary route and only the first source message on refresh", async () => {
    const { llm, calls } = await createLlm();
    const provider = createTitleProvider(llm, config);
    const input = request();
    // No model credential exists in this environment: the real runtime resolves
    // the route and reports the missing adapter. The request it received is the
    // assertion; response acceptance needs a live route (task 4.1).
    await expect(
      provider.generate({
        ...input,
        messages: [...input.messages, { seq: SessionSeq(9), text: "Unrelated later task" }],
      }),
    ).rejects.toThrow(noAdapter);
    expect(provider.automatic).toBe("first-prompt");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      purpose: "session-title",
      sessionId: input.session.id,
      system: SUMMARY_INSTRUCTIONS,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(promptOf(calls[0]!)).toContain("Fix login");
    expect(promptOf(calls[0]!)).not.toContain("Unrelated");
  });

  it.each(["x", "漢", "🚀", '"\\\n\u0000'])(
    "bounds actual requests for %j without corrupting JSON or Unicode",
    async (unit) => {
      const { llm, calls } = await createLlm();
      await expect(
        createTitleProvider(llm, config).generate(request(unit.repeat(200_000))),
      ).rejects.toThrow(noAdapter);
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
    const { llm, calls } = await createLlm();
    let model = "one/model";
    let enabled = true;
    const provider = createTitleProvider(llm, {
      model: { get: () => model },
      enabled: { get: () => enabled },
    });
    await expect(provider.generate(request())).rejects.toThrow(
      'no adapter registered for provider "one"',
    );
    model = "two/other";
    await expect(provider.generate(request())).rejects.toThrow(
      'no adapter registered for provider "two"',
    );
    enabled = false;
    await expect(provider.generate(request())).rejects.toThrow("disabled");
    expect(calls.map(({ provider: route }) => route)).toEqual(["one", "two"]);
  });

  it.each(["", "bad", "provider/", "/model"])(
    "rejects missing or malformed route %j before calling the model",
    async (model) => {
      const { llm, calls } = await createLlm();
      await expect(createTitleProvider(llm, { model }).generate(request())).rejects.toThrow(
        "not configured",
      );
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects empty input and already-cancelled requests before starting a stream", async () => {
    const { llm, calls } = await createLlm();
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
    expect(calls).toHaveLength(0);
  });

  it("clears its deadline timer when the real model route fails", async () => {
    vi.useFakeTimers();
    const { llm } = await createLlm();
    await expect(createTitleProvider(llm, config).generate(request())).rejects.toThrow(noAdapter);
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
