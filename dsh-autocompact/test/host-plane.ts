/**
 * Real dsh host plane for the autocompact tests.
 *
 * Every test mounts the pinned `@deepseek-ai/dsh-*` services it needs through
 * Cordis' public `ctx.plugin()` API: the session store, the projection registry,
 * the token meter, the LLM runtime, the command registry, and a compaction
 * service. Nothing here replaces a host module, and no host API is spied on.
 *
 * The two test-owned seams are real public service contracts, not stand-ins for
 * the host:
 *
 * - {@link RecordingCompactionEngine} extends the real abstract
 *   `CompactionEngine` service. `dsh-compaction-basic`, the shipped backend,
 *   is not part of this package's pinned closure, so the tests provide the
 *   smallest real backend at the documented seam: it publishes a native policy
 *   and records the region a caller asked it to compact. Summary generation is
 *   model-backed and therefore credential-gated (task 4.1); these tests never
 *   inject a model stream.
 * - {@link MetadataLlmAdapter} is a real `LlmAdapter` that resolves route
 *   metadata (context window / default output cap). It never streams: its
 *   `stream` throws the credential gate's diagnostic, so a test that tried to
 *   exercise a model call would fail loudly instead of receiving a fake.
 *
 * Agents come from the real `AgentRegistry.create()` backed by the real
 * `AgentLoop` factory (with the real tool and system-prompt services it
 * injects), so each subject carries the session, options, and scoped context
 * the host itself builds. The preset-mounted backend path
 * (`agentPresets.serviceFor`) is exercised where the host composes it — the
 * shipped web profile, whose root compaction row is disabled — by
 * `client-plane.test.ts`.
 *
 * @module @indexyz/dsh-autocompact/test/host-plane
 */
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry, agentEvents } from "@deepseek-ai/dsh-agent";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { CommandResult } from "@deepseek-ai/dsh-commands";
import { CompactionEngine } from "@deepseek-ai/dsh-compaction";
import type { CompactionResult } from "@deepseek-ai/dsh-compaction";
import { LlmAdapter, LlmRuntime, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import { TokenMeter } from "@deepseek-ai/dsh-token-meter";
import ToolsService from "@deepseek-ai/dsh-tools";
import { apply, Config, inject } from "../index.ts";
import type { AutocompactConfig } from "../index.ts";

/** Native policy a real compaction backend publishes for retention resolution. */
export interface BackendConfig {
  readonly auto: boolean;
  readonly retainRatio?: number;
  readonly retainTokens?: number;
}

/** One explicit `compactRegion` call observed by the real compaction service. */
export interface RegionCall {
  readonly start: SessionSeq;
  readonly end: SessionSeq;
  readonly agent: Agent;
  readonly signal: AbortSignal | undefined;
}

/**
 * A real compaction service at the documented seam.
 *
 * It owns the `ctx.compaction` service (`CompactionEngine`'s constructor does
 * that), publishes the native policy the plugin introspects, and records the
 * region it is asked to compact. `compactIfNeeded` and `compactNow` are not
 * exercised by this plugin, so they answer "nothing to do" as a backend without
 * an active pressure policy would.
 */
export class RecordingCompactionEngine extends CompactionEngine {
  readonly config: BackendConfig;
  readonly calls: RegionCall[] = [];
  failNext = false;

  constructor(ctx: Context, config: BackendConfig) {
    super(ctx);
    this.config = config;
  }

  async compactIfNeeded(): Promise<CompactionResult | null> {
    return null;
  }

  async compactNow(): Promise<CompactionResult | null> {
    return null;
  }

  async compactRegion(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("transport error");
    }
    this.calls.push({ start, end, agent, signal });
    return {
      compactionId: `test-compaction-${this.calls.length}` as CompactionResult["compactionId"],
      startSeq: start,
      summarySeq: start,
      endSeq: end,
      summary: [],
      shadowedRange: { start, end },
      shadowedSeqs: [],
      shadowedTokenCount: 0,
    };
  }
}

/** Route metadata the plugin resolves, without any model transport. */
export interface AdapterOptions {
  readonly provider: string;
  readonly model: string;
  /** `undefined` models an adapter that publishes no context capacity. */
  readonly contextWindow: number | undefined;
  readonly defaultMaxTokens?: number;
}

/** Real `LlmAdapter` that resolves route metadata and refuses model streams. */
export class MetadataLlmAdapter extends LlmAdapter {
  readonly #options: AdapterOptions;

  constructor(options: AdapterOptions) {
    super();
    this.#options = options;
  }

  providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: provider };
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      ...(this.#options.contextWindow === undefined
        ? {}
        : { context: { contextWindow: this.#options.contextWindow } }),
      ...(this.#options.defaultMaxTokens === undefined
        ? {}
        : { defaultMaxTokens: this.#options.defaultMaxTokens }),
    };
  }

  // The only abstract method. A model call needs a credential route that this
  // environment does not hold, so it fails loudly instead of faking a stream.
  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
        throw new Error("credential-gated: no model route is configured (task 4.1)");
      },
    };
  }
}

/** Options for the real service graph shared by the host tests. */
export interface RuntimeOptions extends AdapterOptions {
  /** When false no Host-plane compaction service is mounted. */
  readonly backend?: boolean;
  readonly backendConfig?: BackendConfig;
}

/** Services one mounted test runtime exposes. */
export interface TestRuntime {
  readonly ctx: Context;
  readonly backend: RecordingCompactionEngine | undefined;
}

const DEFAULT_BACKEND: BackendConfig = { auto: true, retainRatio: 0.16, retainTokens: 1 };

/** Warnings captured from the real logger service, per mounted context. */
const capturedWarnings = new WeakMap<Context, string[]>();

/**
 * Mount the real dsh services in dependency order, then the plugin itself.
 *
 * @param runtime - route metadata and backend shape for this composition.
 * @param pluginConfig - row configuration validated by the package's own `Config`.
 * @returns the context, the mounted backend (when any), and the resolved config.
 */
export async function mountRuntime(
  runtime: RuntimeOptions,
  pluginConfig: Record<string, unknown> = {},
): Promise<TestRuntime & { readonly config: AutocompactConfig }> {
  const ctx = new Context();
  const logged: string[] = [];
  capturedWarnings.set(ctx, logged);
  // The built-in buffer keeps only records at the default level, so the tests
  // install a real logger exporter at the lowest level to observe warnings.
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      if (message.type === "warn") {
        logged.push(message.args.map((argument) => String(argument)).join(" "));
      }
    },
  });
  // Any mount below may throw (a host contract change, an invalid row); the
  // half-built graph is disposed before the failure propagates.
  try {
    await ctx.plugin(SessionStore).await();
    await ctx.plugin(SessionProjectionRegistry).await();
    await ctx.plugin(TokenMeter).await();
    await ctx.plugin(LlmRuntime).await();
    ctx.llm.registerAdapter([runtime.provider], new MetadataLlmAdapter(runtime));
    await ctx.plugin(CommandRuntime).await();
    await ctx.plugin(AgentRegistry).await();
    await ctx.plugin(SystemPrompt).await();
    await ctx.plugin(ToolsService).await();
    await ctx.plugin(AgentLoop, {}).await();
    let backend: RecordingCompactionEngine | undefined;
    if (runtime.backend !== false) {
      await ctx.plugin(RecordingCompactionEngine, runtime.backendConfig ?? DEFAULT_BACKEND).await();
      backend = ctx.get("compaction") as RecordingCompactionEngine;
    }
    let resolved: AutocompactConfig | undefined;
    const entry = {
      apply: (inner: Context, config: AutocompactConfig) => {
        resolved = config;
        apply(inner, config);
      },
      inject: [...inject],
      Config,
    };
    await ctx.plugin(entry, pluginConfig).await();
    if (resolved === undefined) throw new Error("the plugin did not run apply");
    return { ctx, backend, config: resolved };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

let nextAgent = 0;

/**
 * Create a live root Agent through the real `AgentRegistry`, whose `AgentLoop`
 * factory prepares its Session, publishes it in the session store, and binds
 * its scoped context and options.
 */
export async function createAgent(ctx: Context, provider: string, model: string): Promise<Agent> {
  nextAgent += 1;
  const handle = await ctx.agents.create({
    sessionId: SessionId(`autocompact-test-${String(nextAgent)}`),
    agentOptions: { provider, model },
  });
  return handle.agent;
}

/** Dispatch the real `agent/pre-step` waterfall for one agent. */
export function step(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  const provider = agent.options.provider ?? "provider";
  const model = agent.options.model ?? "model";
  return agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    {
      messages: [],
      turn: 1,
      step: 1,
      signal,
      modelSelection: { provider, model },
    },
    async (): Promise<PreStepDecision> => ({ kind: "enter", messages: [] }),
  );
}

/** Execute one slash command through the real command registry. */
export async function runCommand(
  ctx: Context,
  agent: Agent,
  line: string,
  signal = new AbortController().signal,
): Promise<CommandResult | undefined> {
  const execution = await ctx.commands.execute(agent, line, [], signal);
  return execution?.result;
}

/** Append one real user message to a real session surface. */
export function appendUserText(session: Session, text: string): SessionSeq {
  return session.append(
    "user/message",
    createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
    { surfaceOp: "append" },
  ).seq;
}

/**
 * Route the session's next request to another model the way the agent loop
 * does: append the real `request/header` event whose fold `requestHeader()`
 * reads.
 */
export function switchModel(session: Session, provider: string, model: string): void {
  session.append("request/header", { header: { config: { provider, model } }, reason: "change" });
}

/** Append `count` real user messages of `size` characters each. */
export function appendUserMessages(session: Session, count: number, size = 40): SessionSeq[] {
  return Array.from({ length: count }, (_, index) =>
    appendUserText(session, String.fromCharCode(97 + (index % 26)).repeat(size)),
  );
}

/** Warnings the real logger service delivered, formatted as text. */
export function warnings(ctx: Context): string[] {
  return capturedWarnings.get(ctx) ?? [];
}

/**
 * Write one resolved volatile config reference the way the Host settings
 * service does: replace its snapshot through the shared volatile protocol.
 *
 * @param reference - the reference `Config` handed the running plugin.
 * @param value - the new field value.
 */
export function writeLiveConfig(reference: unknown, value: unknown): void {
  if (!isVolatile(reference)) {
    throw new Error("expected a volatile config reference");
  }
  reference[VOLATILE_WRITE](value);
}

/** The shared protocol the Host settings service uses to update a volatile field. */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

function isVolatile(value: unknown): value is Record<symbol, (next: unknown) => void> {
  return typeof value === "object" && value !== null && VOLATILE_WRITE in value;
}
