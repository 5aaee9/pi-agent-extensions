import { describe, expect, it } from "vitest";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";
import { ToolCallId } from "@deepseek-ai/dsh-llm";

import {
  buildSuggestionPrompt,
  messageText,
  normalizeSuggestion,
  selectRecentTurns,
  suggestionFromBlocks,
} from "../src/host/history.ts";
import {
  MAX_INPUT_BYTES,
  MAX_SUGGESTION_CHARS,
  SUGGESTION_INSTRUCTIONS,
} from "../src/host/constants.ts";

function user(text: string, source: Message["source"] = { kind: "user" }): Message {
  return createUserMessage({ content: [{ type: "text", text }], source });
}

function assistant(text: string, extra: readonly ContentBlock[] = []): Message {
  return createAssistantMessage({
    content: [{ type: "text", text }, ...extra],
    source: { provider: "main", model: "main" },
  });
}

describe("message and history selection", () => {
  it("extracts only visible text blocks", () => {
    const message = createAssistantMessage({
      content: [
        { type: "reasoning", text: "private" },
        { type: "text", text: "visible" },
        {
          type: "tool-call",
          id: ToolCallId("call-1"),
          name: "bash",
          arguments: "{}",
        },
      ],
      source: { provider: "main", model: "main" },
    });
    expect(messageText(message)).toBe("visible");
  });

  it("keeps direct human turns, ignores synthetic users, and takes the final answer", () => {
    const messages: Message[] = [
      user("first"),
      assistant("intermediate", [
        { type: "tool-call", id: ToolCallId("call-1"), name: "read", arguments: "{}" },
      ]),
      assistant("first answer"),
      user("synthetic context", { kind: "system-prompt" }),
      user("second"),
      assistant("second answer"),
      user("failed turn"),
      user("third"),
      assistant("third answer"),
    ];
    expect(selectRecentTurns(messages)).toEqual([
      { user: "first", assistant: "first answer" },
      { user: "second", assistant: "second answer" },
      { user: "third", assistant: "third answer" },
    ]);
  });

  it("limits context to the eight newest completed turns", () => {
    const messages: Message[] = [];
    for (let index = 0; index < 10; index += 1) {
      messages.push(user(`question ${index}`), assistant(`answer ${index}`));
    }
    const turns = selectRecentTurns(messages);
    expect(turns).toHaveLength(8);
    expect(turns[0]?.user).toBe("question 2");
    expect(turns[7]?.assistant).toBe("answer 9");
  });
});

describe("suggestion prompt", () => {
  it("frames valid JSON within the UTF-8 budget", () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      user: `user ${index} ${"🚀漢".repeat(2000)}`,
      assistant: `assistant ${index} ${"x".repeat(2000)}`,
    }));
    const prompt = buildSuggestionPrompt(turns);
    expect(Buffer.byteLength(SUGGESTION_INSTRUCTIONS + prompt, "utf8")).toBeLessThanOrEqual(
      MAX_INPUT_BYTES,
    );
    const framed = prompt.slice(prompt.indexOf("\n") + 1);
    const decoded: unknown = JSON.parse(framed);
    expect(Array.isArray(decoded)).toBe(true);
    expect(framed).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
  });

  it("returns an empty payload when only one enormous exchange exists", () => {
    const prompt = buildSuggestionPrompt([
      { user: "a".repeat(100_000), assistant: "b".repeat(100_000) },
    ]);
    expect(Buffer.byteLength(SUGGESTION_INSTRUCTIONS + prompt, "utf8")).toBeLessThanOrEqual(
      MAX_INPUT_BYTES,
    );
    const decoded: unknown = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    expect(Array.isArray(decoded)).toBe(true);
    expect(JSON.stringify(decoded).length).toBeGreaterThan(2);
  });

  it("returns nothing for no turns", () => {
    expect(buildSuggestionPrompt([])).toBe("");
  });
});

describe("suggestion normalization", () => {
  it.each([
    ['  "Can you add a test?"  ', "Can you add a test?"],
    ["```text\n继续修复登录\n```", "继续修复登录"],
    ["Suggestion: 再加一个回归测试", "再加一个回归测试"],
    ["first line\nsecond line", "first line"],
    ["\u0000\u200B  please retry  \u202E", "please retry"],
  ])("normalizes %j", (raw, expected) => {
    expect(normalizeSuggestion(raw)).toBe(expected);
  });

  it.each(["", "   ", "no suggestion", "无建议", "x", "As an AI I cannot predict"])(
    "rejects unusable output %j",
    (raw) => {
      expect(normalizeSuggestion(raw)).toBe("");
    },
  );

  it("caps long suggestions at complete code points", () => {
    const normalized = normalizeSuggestion("🚀".repeat(MAX_SUGGESTION_CHARS + 20));
    expect([...normalized]).toHaveLength(MAX_SUGGESTION_CHARS);
    expect(normalized).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
  });

  it("drops any response containing a tool call and ignores reasoning", () => {
    expect(
      suggestionFromBlocks([
        { type: "reasoning", text: "plan" },
        { type: "text", text: "I can do that" },
        { type: "tool-call", id: ToolCallId("call-1"), name: "bash", arguments: "{}" },
      ]),
    ).toBe("");
    expect(
      suggestionFromBlocks([
        { type: "reasoning", text: "plan" },
        { type: "text", text: "Add the regression test" },
      ]),
    ).toBe("Add the regression test");
  });
});
