/**
 * Real Harness plane shared by the Host tests.
 *
 * Mounts the pinned Cordis runtime and the real services the plugin injects,
 * then the plugin itself. Model requests are observed through the real
 * `llm/stream` waterfall; the listener only records the request and delegates,
 * so the runtime's own adapter resolution and failure decide the outcome. No
 * model stream or model resolution is replaced: response-dependent assertions
 * need a credential route and stay pending (OpenSpec task 4.1).
 */
import { setImmediate } from "node:timers/promises";

import { Context } from "@deepseek-ai/cordis";
import { createAssistantMessage, createUserMessage, LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Session } from "@deepseek-ai/dsh-session";
import { onTestFinished } from "vitest";

import { apply, Config, inject } from "../index.ts";
import { SuggestionEngine } from "../src/host/engine.ts";
import type { SuggestionConfig } from "../src/host/engine.ts";

/** Real validated `enabled` row value; the Host settings plane owns its writes. */
export type LiveConfig = ReturnType<typeof Config>;

/** One Fetch route as the real Connection registry receives it. */
interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch(request: Request): Promise<Response>;
}

/** A mounted Host plane plus the real requests it sent to the LLM runtime. */
export interface HostPlane {
  readonly ctx: Context;
  readonly session: Session;
  readonly calls: GenerateOptions[];
  readonly routes: RegisteredRoute[];
}

const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/** Build the real validated config the Loader would pass to the plugin. */
export function liveConfig(enabled = true): LiveConfig {
  return Config({ enabled });
}

/** Write the live reference exactly as the Host settings service does. */
export function setLiveEnabled(config: LiveConfig, enabled: boolean): void {
  const field: unknown = Reflect.get(config as object, "enabled");
  if (typeof field !== "object" || field === null) throw new Error("enabled must be a live field");
  const write: unknown = Reflect.get(field, VOLATILE_WRITE);
  if (typeof write !== "function") throw new Error("enabled must be a live field");
  write.call(field, enabled);
}

/**
 * Mount the real pinned services, the real plugin, and one real session.
 * @param config - the validated row configuration.
 * @returns the mounted plane; disposed after the test.
 */
export async function createHostPlane(config: SuggestionConfig = liveConfig()): Promise<HostPlane> {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(LlmRuntime).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  const routes: RegisteredRoute[] = [];
  // The pinned closure exports HostConnectionService but cannot mount it
  // keylessly: its activation needs a credential provider for BrowserAuth.
  // Record the routes the real plugin registers on the real Connection face.
  ctx.provide("connection", {
    fetch: {
      register(route: RegisteredRoute) {
        routes.push(route);
        return async () => {
          const index = routes.indexOf(route);
          if (index !== -1) routes.splice(index, 1);
        };
      },
    },
    rpc: {},
  } as unknown as Context["connection"]);
  await ctx.plugin({ apply, inject: [...inject] }, config).await();
  const session = ctx.sessions.create();
  return { ctx, session, calls, routes };
}

/** Append one direct human message to the real session log. */
export function addUser(session: Session, text: string): void {
  session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
    { surfaceOp: "append" },
  );
}

/** Append one visible assistant message to the real session log. */
export function addAssistant(session: Session, text: string, turn = 1, step = 1): void {
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

/** Log the route the main request used, which the suggestion reuses. */
export function addRequestHeader(
  session: Session,
  provider = "main-provider",
  model = "main-model",
): void {
  session.append("request/header", {
    reason: "initial",
    header: { config: { provider, model } },
  });
}

/** Start one real turn. */
export function startTurn(session: Session, turn: number): void {
  session.append("turn/start", { turn });
}

/** End one real turn with the requested outcome. */
export function endTurn(
  session: Session,
  turn: number,
  reason: "completed" | "error" = "completed",
): void {
  session.append(
    "turn/end",
    reason === "completed"
      ? { turn, reason: { kind: "completed" } }
      : { turn, reason: { kind: "error", error: { code: "UNKNOWN", message: "model failed" } } },
  );
}

/** Let the real event dispatch and the plugin's queued work run. */
export async function flush(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await setImmediate();
}

/** Prompt text the auxiliary request carries, as the real runtime received it. */
export function promptOf(options: GenerateOptions): string {
  return options.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** One suggestion answer as the route returns it. */
export type SuggestionReply =
  | { readonly state: "ready"; readonly text: string }
  | { readonly state: "pending" }
  | { readonly state: "none" }
  | { readonly state: "disabled" };

/**
 * Query the route the real plugin registered, through its real Fetch handler.
 * @param routes - routes currently registered on the Connection face.
 * @param sessionId - session the browser asks about.
 * @param signal - browser cancellation.
 * @returns the Host's reply.
 */
export async function querySuggestion(
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

/** A real pinned LLM service plus the requests it actually dispatched. */
export interface LlmPlane {
  readonly ctx: Context;
  readonly calls: GenerateOptions[];
}

/**
 * Mount the real pinned `dsh-llm` runtime and observe its `llm/stream`
 * waterfall. The listener delegates to the runtime, so the adapter dispatch and
 * its outcome are the real ones.
 * @returns the mounted plane; disposed after the test.
 */
export async function createLlmPlane(): Promise<LlmPlane> {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(LlmRuntime).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  return { ctx, calls };
}

/** A real engine over the real session service, without the plugin's route wiring. */
export interface EnginePlane {
  readonly ctx: Context;
  readonly engine: SuggestionEngine;
  readonly session: Session;
}

/**
 * Mount the real services and construct the real suggestion engine directly so
 * route tests can drive it without a second transport.
 * @param config - the validated row configuration.
 * @returns the mounted plane; disposed after the test.
 */
export async function createEnginePlane(
  config: SuggestionConfig = liveConfig(),
): Promise<EnginePlane> {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(LlmRuntime).await();
  const engine = new SuggestionEngine(ctx, config);
  const session = ctx.sessions.create();
  return { ctx, engine, session };
}
