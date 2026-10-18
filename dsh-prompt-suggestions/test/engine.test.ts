import { setImmediate } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import {
  createAssistantMessage,
  createUserMessage,
  LlmRuntime,
  ReasoningEffortId,
} from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Session } from "@deepseek-ai/dsh-session";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { apply, inject } from "../index.ts";
import type { SuggestionConfig, SuggestionReply } from "../src/host/engine.ts";
import { turnHasPredictionInput } from "../src/host/engine.ts";

interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch(request: Request): Promise<Response>;
}

function successfulStream(): StreamChunk[] {
  return [
    { type: "text-delta", index: 0, text: ' "Add a regression test" ' },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

function modelInfo(): LlmResolvedModelInfo {
  return {
    provider: "main-provider",
    id: "main-model",
    name: "Main Model",
    reasoning: {
      efforts: [
        { id: ReasoningEffortId("off"), name: "Off" },
        { id: ReasoningEffortId("low"), name: "Low" },
        { id: ReasoningEffortId("high"), name: "High" },
      ],
    },
  };
}

async function createHost(
  config: SuggestionConfig = { enabled: true },
  chunks: (options: GenerateOptions) => AsyncIterable<StreamChunk> = async function* () {
    yield* successfulStream();
  },
) {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(LlmRuntime).await();
  const calls: GenerateOptions[] = [];
  vi.spyOn(ctx.llm, "stream").mockImplementation(async function* (options) {
    calls.push(options);
    yield* chunks(options);
  });
  vi.spyOn(ctx.llm, "resolveModelInfo").mockResolvedValue(modelInfo());
  const routes: RegisteredRoute[] = [];
  ctx.provide("connection", {
    fetch: {
      register(route: RegisteredRoute) {
        routes.push(route);
        return async () => {};
      },
    },
    rpc: {},
  } as unknown as Context["connection"]);
  await ctx.plugin({ apply, inject: [...inject] }, config).await();
  const session = ctx.sessions.create();
  return { ctx, calls, routes, session };
}

function addHeader(session: Session, provider = "main-provider", model = "main-model"): void {
  session.append("request/header", {
    reason: "initial",
    header: { config: { provider, model } },
  });
}

function addUser(session: Session, text: string): void {
  session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
    { surfaceOp: "append" },
  );
}

function addAssistant(session: Session, text: string, turn = 1, step = 1): void {
  session.append(
    "assistant/message",
    {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: "text", text }],
        source: { provider: "main-provider", model: "main-model" },
      }),
      stream: [],
    },
    { surfaceOp: "append" },
  );
}

function startTurn(session: Session, turn: number): void {
  session.append("turn/start", { turn });
}

function endTurn(
  session: Session,
  turn: number,
  reason: "completed" | "error" = "completed",
): void {
  session.append(
    "turn/end",
    reason === "completed"
      ? { turn, reason: { kind: "completed" } }
      : {
          turn,
          reason: {
            kind: "error",
            error: { code: "UNKNOWN", message: "model failed" },
          },
        },
  );
}

async function query(
  routes: readonly RegisteredRoute[],
  sessionId: string,
  signal?: AbortSignal,
): Promise<SuggestionReply> {
  const route = routes.find((item) => item.path === "/api/prompt-suggestions/suggest");
  if (route === undefined) throw new Error("suggestion route not registered");
  const response = await route.fetch(
    new Request("http://localhost/api/prompt-suggestions/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(signal === undefined ? {} : { signal }),
      body: JSON.stringify({
        type: "client-request",
        rpcId: "test-rpc",
        method: "prompt-suggestions/suggest",
        payload: { sessionId },
      }),
    }),
  );
  const body = (await response.json()) as {
    result: { ok: true; value: SuggestionReply } | { ok: false };
  };
  if (!body.result.ok) throw new Error("suggestion query failed");
  return body.result.value;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await setImmediate();
}

describe("turn input helpers", () => {
  it("requires direct human input and visible assistant text", async () => {
    const { session } = await createHost();
    addHeader(session);
    startTurn(session, 1);
    expect(turnHasPredictionInput(session, 1)).toBe(false);
    addUser(session, "Fix login");
    expect(turnHasPredictionInput(session, 1)).toBe(false);
    addAssistant(session, "Fixed");
    expect(turnHasPredictionInput(session, 1)).toBe(true);
  });
});

describe("suggestion engine with Harness services", () => {
  it("generates one low-effort suggestion for a watched completed turn", async () => {
    const { session, routes, calls } = await createHost();
    addHeader(session);
    startTurn(session, 1);
    // The first empty-composer query marks the session watched while the turn
    // is still running, so the completion can generate without another query.
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Fix the login redirect");
    addAssistant(session, "Updated the redirect and added a test.");
    endTurn(session, 1);
    const before = session.snapshotEvents().length;
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "main-provider",
      model: "main-model",
      reasoningEffort: ReasoningEffortId("low"),
      sessionId: session.id,
      maxTokens: 512,
    });
    expect(calls[0]?.tools).toBeUndefined();
    expect(calls[0]?.purpose).toBeUndefined();
    const prompt = calls[0]?.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    expect(prompt).toContain("Fix the login redirect");
    expect(prompt).toContain("Updated the redirect");
    expect(session.snapshotEvents()).toHaveLength(before);

    await expect(query(routes, session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(session.snapshotEvents()).toHaveLength(before);
  });

  it("does not generate for failed, interrupted, or text-free turns", async () => {
    const { session, routes, calls } = await createHost();
    addHeader(session);
    await query(routes, session.id);
    startTurn(session, 1);
    addUser(session, "One");
    addAssistant(session, "Done");
    endTurn(session, 1, "error");
    startTurn(session, 2);
    addUser(session, "Two");
    endTurn(session, 2);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
  });

  it("does not generate for a replayed completed turn before the session is watched", async () => {
    const { session, routes, calls } = await createHost();
    addHeader(session);
    startTurn(session, 1);
    addUser(session, "Summarize the diff");
    addAssistant(session, "The diff changes three files.");
    endTurn(session, 1);
    expect(calls).toHaveLength(0);

    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(0);
  });

  it("uses at most eight recent turns in the auxiliary prompt", async () => {
    const { session, routes, calls } = await createHost();
    addHeader(session);
    for (let turn = 1; turn <= 9; turn += 1) {
      startTurn(session, turn);
      addUser(session, `question ${turn}`);
      addAssistant(session, `answer ${turn}`, turn);
      endTurn(session, turn);
    }
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    startTurn(session, 10);
    addUser(session, "question 10");
    addAssistant(session, "answer 10", 10);
    endTurn(session, 10);
    await flush();
    await expect(query(routes, session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(calls).toHaveLength(1);
    const prompt = calls[0]?.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const framed = prompt.slice(prompt.indexOf("\n") + 1);
    const decoded = JSON.parse(framed) as { user: string }[];
    expect(decoded.map((item) => item.user)).toEqual([
      "question 3",
      "question 4",
      "question 5",
      "question 6",
      "question 7",
      "question 8",
      "question 9",
      "question 10",
    ]);
  });

  it("cancels an in-flight suggestion when its query is aborted", async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session, routes, calls } = await createHost({ enabled: true }, async function* () {
      await blocked;
      yield* successfulStream();
    });
    addHeader(session);
    await query(routes, session.id);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await flush();
    expect(calls).toHaveLength(1);
    const generationSignal = calls[0]?.signal;
    expect(generationSignal?.aborted).toBe(false);

    const controller = new AbortController();
    const pending = query(routes, session.id, controller.signal);
    await flush();
    controller.abort();
    await expect(pending).resolves.toEqual({ state: "none" });
    expect(generationSignal?.aborted).toBe(true);
    release();
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("aborts an in-flight suggestion when a new turn starts", async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    const { session, routes, calls } = await createHost({ enabled: true }, async function* () {
      try {
        await blocked;
        yield* successfulStream();
      } finally {
        closed = true;
      }
    });
    addHeader(session);
    await query(routes, session.id);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await flush();
    expect(calls).toHaveLength(1);
    const signal = calls[0]?.signal;
    expect(signal?.aborted).toBe(false);

    startTurn(session, 2);
    expect(signal?.aborted).toBe(true);
    release();
    await flush();
    expect(closed).toBe(true);
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    expect(calls).toHaveLength(1);
  });

  it("honors the live enabled switch", async () => {
    let enabled = false;
    const { session, routes, calls } = await createHost({ enabled: { get: () => enabled } });
    addHeader(session);
    startTurn(session, 1);
    addUser(session, "Fix login");
    addAssistant(session, "Fixed", 1);
    endTurn(session, 1);
    await flush();
    expect(calls).toHaveLength(0);
    await expect(query(routes, session.id)).resolves.toEqual({ state: "disabled" });

    enabled = true;
    startTurn(session, 2);
    await expect(query(routes, session.id)).resolves.toEqual({ state: "none" });
    addUser(session, "Continue");
    addAssistant(session, "Continued", 2);
    endTurn(session, 2);
    await flush();
    await expect(query(routes, session.id)).resolves.toEqual({
      state: "ready",
      text: "Add a regression test",
    });
    expect(calls).toHaveLength(1);
  });
});
