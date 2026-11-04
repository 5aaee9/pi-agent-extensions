import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";

import {
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  buildBaseOptions as hostBuildBaseOptions,
  clampMaxTokensToContext as hostClampMaxTokens,
} from "@earendil-works/pi-ai/api/simple-options";
import { transformMessages as hostTransformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { estimateContextTokens as hostEstimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildBaseOptions,
  clampMaxTokensToContext,
  estimateContextTokens,
  transformMessages,
} from "../pi-ai-internal.ts";

/**
 * Pi's extension module mapping does not expose these functions, so the package
 * carries copies. They run here beside the pinned host's own, which a test can
 * import, on the same fixtures: any difference is drift to port on a pin bump.
 */

const model: Model<Api> = {
  id: "target",
  name: "Target",
  api: "ollama-chat",
  provider: "local",
  baseUrl: "http://localhost",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_768,
  maxTokens: 4096,
};
const visionModel: Model<Api> = { ...model, input: ["text", "image"] };

const usage = {
  input: 10,
  output: 5,
  cacheRead: 1,
  cacheWrite: 1,
  totalTokens: 17,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const noUsage = { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

const assistant = (
  content: AssistantMessage["content"],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage => ({
  role: "assistant",
  content,
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage,
  stopReason: "stop",
  timestamp: 2,
  ...overrides,
});
const fromOtherModel = { model: "other" };
const user = (content: Extract<Message, { role: "user" }>["content"], timestamp = 1): Message => ({
  role: "user",
  content,
  timestamp,
});
const image = { type: "image", data: "aGk=", mimeType: "image/png" } as const;
const call = (id: string) =>
  ({ type: "toolCall", id, name: "read", arguments: { path: "a" } }) as const;
const toolResult = (
  toolCallId: string,
  content: Extract<Message, { role: "toolResult" }>["content"],
): Message => ({
  role: "toolResult",
  toolCallId,
  toolName: "read",
  content,
  isError: false,
  timestamp: 3,
});
const system = (content: string): Message => ({ role: "system", content, timestamp: 2 });

const thinkingBlocks: AssistantMessage["content"] = [
  { type: "thinking", thinking: "plain thought" },
  { type: "thinking", thinking: "signed thought", thinkingSignature: "sig" },
  { type: "thinking", thinking: "", thinkingSignature: "encrypted" },
  { type: "thinking", thinking: "opaque", redacted: true },
  { type: "thinking", thinking: "   " },
  { type: "text", text: "answer", textSignature: "text-sig" },
];

const messageFixtures: ReadonlyArray<{
  readonly name: string;
  readonly messages: Message[];
  readonly target?: Model<Api>;
  readonly normalize?: (id: string) => string;
}> = [
  { name: "same-model thinking and text", messages: [assistant(thinkingBlocks)] },
  {
    name: "cross-model thinking and text",
    messages: [assistant(thinkingBlocks, fromOtherModel)],
  },
  {
    name: "thinking from another provider",
    messages: [assistant(thinkingBlocks, { provider: "other" })],
  },
  {
    name: "thinking from another API",
    messages: [assistant(thinkingBlocks, { api: "openai-responses" })],
  },
  {
    name: "same-model tool call keeps its thought signature",
    messages: [assistant([{ ...call("a"), thoughtSignature: "thought" }]), toolResult("a", [])],
  },
  {
    name: "cross-model tool call loses its thought signature",
    messages: [
      assistant([{ ...call("a"), thoughtSignature: "thought" }], fromOtherModel),
      toolResult("a", []),
    ],
  },
  {
    name: "cross-model tool call ids are normalized, results included",
    messages: [
      assistant([call("a|b")], fromOtherModel),
      toolResult("a|b", [{ type: "text", text: "r" }]),
    ],
    normalize: (id) => id.replace("|", "_"),
  },
  {
    name: "same-model tool call ids are not normalized",
    messages: [assistant([call("a|b")]), toolResult("a|b", [])],
    normalize: (id) => id.replace("|", "_"),
  },
  {
    name: "a user turn closes orphaned tool calls",
    messages: [assistant([call("a"), call("b")]), toolResult("b", []), user("next", 4)],
  },
  { name: "a conversation ending on a tool call", messages: [assistant([call("a")])] },
  {
    name: "a system message between a tool call and its result is held back",
    messages: [assistant([call("a")]), system("mid"), toolResult("a", []), user("next", 4)],
  },
  {
    name: "a system message after an orphaned tool call",
    messages: [assistant([call("a")]), system("mid"), assistant([{ type: "text", text: "t" }])],
  },
  {
    name: "errored and aborted turns are not replayed",
    messages: [
      user("hi"),
      assistant([{ type: "thinking", thinking: "x" }], { stopReason: "error" }),
      assistant([call("a")], { stopReason: "aborted" }),
      user("again", 4),
    ],
  },
  {
    name: "images downgrade for a text-only model",
    messages: [
      user([image, image, { type: "text", text: "after" }, image]),
      assistant([call("a")]),
      toolResult("a", [image, { type: "text", text: "r" }]),
    ],
  },
  {
    name: "images pass through for a vision model",
    messages: [user([image]), assistant([call("a")]), toolResult("a", [image])],
    target: visionModel,
  },
  {
    name: "null content from an old session",
    messages: [
      { ...user("x"), content: null } as unknown as Message,
      assistant(null as unknown as AssistantMessage["content"]),
    ],
  },
];

const context = (messages: Message[]): TranscriptContext => normalizeContext({ messages });
const longHistory = context([
  user("u".repeat(7000)),
  assistant([{ type: "thinking", thinking: "t".repeat(700) }, call("a")], { usage: noUsage }),
  toolResult("a", [{ type: "text", text: "r".repeat(70) }, image]),
  system("s".repeat(35)),
]);
const usageThenMore = context([
  user("first"),
  assistant([{ type: "text", text: "reply" }]),
  user("y".repeat(351), 4),
]);
const usageBeforeSummary = context([
  assistant([{ type: "text", text: "old" }], { timestamp: 1 }),
  { ...user("summary".repeat(50)), timestamp: 5 },
]);

const estimateFixtures: ReadonlyArray<{
  readonly name: string;
  readonly value: TranscriptContext;
}> = [
  { name: "estimated history with tools and images", value: longHistory },
  { name: "usage plus trailing messages", value: usageThenMore },
  { name: "usage older than a later prefix message", value: usageBeforeSummary },
];

const onPayload: SimpleStreamOptions["onPayload"] = () => undefined;
const optionFixtures: ReadonlyArray<{
  readonly name: string;
  readonly target?: Model<Api>;
  readonly options?: SimpleStreamOptions;
}> = [
  { name: "no options" },
  {
    name: "every forwarded option and the simple-only ones",
    options: {
      temperature: 0.5,
      maxTokens: 100,
      signal: new AbortController().signal,
      apiKey: "key",
      transport: "sse",
      cacheRetention: "short",
      sessionId: "session",
      headers: { "x-a": "b" },
      metadata: { user_id: "u" },
      onPayload,
      onResponse: () => undefined,
      onProviderStreamEvent: () => undefined,
      timeoutMs: 10,
      websocketConnectTimeoutMs: 20,
      maxRetries: 2,
      maxRetryDelayMs: 30,
      env: { A: "b" },
      reasoning: "high",
      thinkingBudgets: { high: 100 },
    },
  },
  {
    name: "sampling params from the model, its thinking level, and the request",
    target: {
      ...model,
      samplingParams: { top_p: 0.5, top_k: 1 },
      samplingParamsByThinkingLevel: { high: { top_k: 2, min_p: 0.1 } },
    },
    options: { reasoning: "high", samplingParams: { min_p: 0.2 } },
  },
  { name: "a token cap above the context room", options: { maxTokens: 1_000_000 } },
  { name: "an unknown context window", target: { ...model, contextWindow: 0 } },
];

const named = <T extends { readonly name: string }>(fixtures: readonly T[]) =>
  fixtures.map((fixture) => [fixture.name, fixture] as const);

describe("vendored pi-ai internals match the pinned host", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the pi-ai version this package pins", () => {
    const manifestPath = findPackageJSON("@earendil-works/pi-ai", import.meta.url);
    if (manifestPath === undefined) throw new Error("pi-ai is not installed; run npm install");
    const resolved = (JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string })
      .version;
    const pinned = (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        devDependencies: Record<string, string>;
      }
    ).devDependencies["@earendil-works/pi-ai"];
    expect(resolved, `resolved ${resolved} at ${manifestPath}, but the pin is ${pinned}`).toBe(
      pinned,
    );
  });

  it.each(named(messageFixtures))("transformMessages: %s", (_name, fixture) => {
    const { messages, target, normalize } = fixture;
    const copy = target ?? model;
    expect(transformMessages(structuredClone(messages), copy, normalize)).toStrictEqual(
      hostTransformMessages(structuredClone(messages), copy, normalize),
    );
  });

  it.each(named(estimateFixtures))("estimateContextTokens: %s", (_name, { value }) => {
    expect(estimateContextTokens(value)).toStrictEqual(hostEstimateContextTokens(value));
  });

  it.each(named(optionFixtures))("buildBaseOptions: %s", (_name, { target, options }) => {
    const copy = target ?? model;
    expect(buildBaseOptions(copy, longHistory, options)).toStrictEqual(
      hostBuildBaseOptions(copy, longHistory, options),
    );
  });

  it.each(named(estimateFixtures))("clampMaxTokensToContext: %s", (_name, { value }) => {
    for (const maxTokens of [1, 500, 100_000]) {
      expect(clampMaxTokensToContext(model, value, maxTokens)).toBe(
        hostClampMaxTokens(model, value, maxTokens),
      );
    }
  });
});
