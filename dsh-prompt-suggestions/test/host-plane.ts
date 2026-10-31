/**
 * Real Harness plane shared by the Host tests.
 *
 * Mounts the pinned Cordis runtime and the real services the plugin injects, then
 * the plugin itself:
 *
 * - the real `@deepseek-ai/dsh-credentials-local` provider over a throwaway file,
 *   which is what the real Connection service needs for its browser-session
 *   secret and what the real adapter resolves its API-key reference through;
 * - the real `@deepseek-ai/dsh-client-connection` Host service, whose Fetch
 *   registry receives the plugin's route and whose shared `/api` handler (the one
 *   its HTTP bridge calls after authentication) dispatches the queries;
 * - the real `SessionStore` and `LlmRuntime`, plus the real
 *   `@deepseek-ai/dsh-llm-pi-ai` adapter configured with one declared
 *   `openai-completions` route whose endpoint is a locally started server
 *   (`model-server.ts`). The real pi-ai client sends the request and parses the
 *   wire stream; the test only decides what the endpoint answers.
 *
 * Model requests are additionally observed through the real `llm/stream`
 * waterfall; that listener only records the request and delegates, so the
 * runtime's own adapter resolution and stream are the ones under test.
 */
import { setImmediate } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as Connection from "@deepseek-ai/dsh-client-connection";
import LocalCredentialProvider from "@deepseek-ai/dsh-credentials-local";
import { createAssistantMessage, createUserMessage, LlmRuntime } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import * as PiAi from "@deepseek-ai/dsh-llm-pi-ai";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Session } from "@deepseek-ai/dsh-session";
import { onTestFinished, vi } from "vitest";

import { apply, Config, inject } from "../index.ts";
import { SuggestionEngine } from "../src/host/engine.ts";
import type { SuggestionConfig } from "../src/host/engine.ts";
import { startModelServer, type ModelServer, type Responder } from "./model-server.ts";

/** Real validated `enabled` row value; the Host settings plane owns its writes. */
export type LiveConfig = ReturnType<typeof Config>;

/** The declared adapter route every plane serves. */
export const PROVIDER = "local";
/** A model on {@link PROVIDER} that advertises off/low/high reasoning. */
export const MODEL = "local-model";
/** A model on {@link PROVIDER} that advertises no reasoning levels. */
export const PLAIN_MODEL = "local-plain";
/** Credential reference the route resolves through the real credentials service. */
const KEY_REF = "PROMPT_SUGGESTIONS_LOCAL_KEY";
/** The key the local endpoint expects; it is a test value, not a secret. */
export const LOCAL_KEY = "local-endpoint-key";

/** A mounted Host plane plus the real requests it sent to the LLM runtime. */
export interface HostPlane {
  readonly ctx: Context;
  readonly session: Session;
  readonly calls: GenerateOptions[];
  readonly server: ModelServer;
  /** The plugin's own fiber, so a test can unload it the way the Loader does. */
  readonly plugin: ReturnType<Context["plugin"]>;
  /** Dispatch one raw request through the real Connection service's `/api` handler. */
  dispatch(request: Request): Promise<Response>;
  /** Query the plugin's route through the real Connection service's `/api` handler. */
  query(sessionId: string, signal?: AbortSignal): Promise<SuggestionReply>;
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

/** The `llm-pi-ai` providers table pointing the declared route at `baseURL`. */
function providersFor(baseURL: string): Record<string, unknown> {
  return {
    [PROVIDER]: {
      displayName: "Local endpoint",
      api: "openai-completions",
      baseURL,
      apiKeyEnv: KEY_REF,
      // A failed request must surface at once, not after five backoffs.
      retryPolicy: { mode: "normal", maxRetries: 0 },
      models: [
        { id: MODEL, reasoningEfforts: { off: null, low: "low", high: "high" } },
        { id: PLAIN_MODEL, reasoningEfforts: false },
      ],
    },
  };
}

/** Options for one mounted plane. */
export interface PlaneOptions {
  /** How the local endpoint answers; defaults to a plain text reply. */
  readonly responder?: Responder;
  /** Mount the plugin and the Connection service (route tests skip them). */
  readonly plugin?: boolean;
}

interface BasePlane {
  readonly ctx: Context;
  readonly server: ModelServer;
  readonly calls: GenerateOptions[];
}

/**
 * Mount credentials, sessions, the LLM runtime, and the real adapter over a
 * local endpoint. Everything is disposed after the current test.
 */
async function mountBase(responder: Responder | undefined): Promise<BasePlane> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-ps-host-"));
  const server = await startModelServer(responder);
  const ctx = new Context();
  // Registered before any mount can throw, so a half-built plane is still torn down.
  onTestFinished(async () => {
    await ctx.fiber.dispose();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  vi.stubEnv(KEY_REF, LOCAL_KEY);
  await ctx
    .plugin(LocalCredentialProvider, {
      path: join(dir, ".credentials.yaml"),
      dshHome: dir,
      watch: false,
    })
    .await();
  await ctx.plugin(SessionStore).await();
  await ctx.plugin(LlmRuntime).await();
  // The adapter's schema validates the plain table into its live `providers` field.
  await ctx.plugin(PiAi, { providers: providersFor(server.baseURL) } as never).await();
  const calls: GenerateOptions[] = [];
  ctx.on("llm/stream", (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    calls.push(options);
    return next();
  });
  return { ctx, server, calls };
}

/**
 * Mount the real pinned services, the real plugin, and one real session.
 * @param config - the validated row configuration.
 * @param options - how the local endpoint answers.
 * @returns the mounted plane; disposed after the test.
 */
export async function createHostPlane(
  config: SuggestionConfig = liveConfig(),
  options: PlaneOptions = {},
): Promise<HostPlane> {
  const { ctx, server, calls } = await mountBase(options.responder);
  await ctx.plugin(Connection, {}).await();
  const plugin = ctx.plugin({ apply, inject: [...inject] }, config);
  await plugin.await();
  const handler = ctx.connection.createSharedFetchHandler("/api");
  const peer = ctx.connection.createPeer({ principal: { kind: "owner" } });
  const session = ctx.sessions.create();
  const dispatch = (request: Request): Promise<Response> => handler.fetch(request, peer);
  return {
    ctx,
    session,
    calls,
    server,
    plugin,
    dispatch,
    query: (sessionId, signal) => querySuggestion(dispatch, sessionId, signal),
  };
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
        source: { provider: PROVIDER, model: MODEL },
      }),
      stream: [],
    },
    { surfaceOp: "append" },
  );
}

/** Log the route the main request used, which the suggestion reuses. */
export function addRequestHeader(session: Session, provider = PROVIDER, model = MODEL): void {
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

/**
 * Wait until `condition` holds, yielding to real I/O between checks.
 * @param condition - checked after each yield.
 * @param what - named in the failure.
 * @param timeoutMs - wall-clock budget.
 */
export async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => {
      globalThis.setImmediate(resolve);
    });
  }
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

async function querySuggestion(
  dispatch: (request: Request) => Promise<Response>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SuggestionReply> {
  const response = await dispatch(
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
  if (response.status !== 200) {
    throw new Error(`suggestion route answered ${String(response.status)}`);
  }
  const body = (await response.json()) as {
    result: { ok: true; value: SuggestionReply } | { ok: false };
  };
  if (!body.result.ok) throw new Error("suggestion query failed");
  return body.result.value;
}

/** A real pinned LLM service with the real adapter over a local endpoint. */
export interface LlmPlane {
  readonly ctx: Context;
  readonly calls: GenerateOptions[];
  readonly server: ModelServer;
}

/**
 * Mount the real pinned `dsh-llm` runtime and the real adapter over a local
 * endpoint, observing the `llm/stream` waterfall.
 * @param responder - how the local endpoint answers.
 * @returns the mounted plane; disposed after the test.
 */
export async function createLlmPlane(responder?: Responder): Promise<LlmPlane> {
  return await mountBase(responder);
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
  const { ctx } = await mountBase(undefined);
  const engine = new SuggestionEngine(ctx, config);
  const session = ctx.sessions.create();
  return { ctx, engine, session };
}
