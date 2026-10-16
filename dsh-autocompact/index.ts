/**
 * Session-only per-model automatic compaction thresholds for dsh.
 *
 * The dsh port of `@indexyz/pi-autocompact`. A `/autocompact 300k` threshold is
 * kept in memory for the current session and model only; when the measured
 * request pressure crosses it, the plugin compacts an explicit balanced surface
 * range through the session's mounted compaction backend before the next
 * request. Nothing is written to configuration, the session log carries only
 * the backend's ordinary compaction records, and the model's real context-window
 * metadata is never modified.
 *
 * `compaction` is not a Host-plane service: the shipped Web bundle disables the
 * root row and lets each Agent preset mount its own isolated instance. This
 * plugin therefore mounts on the Host plane (so one row serves every preset) and
 * addresses the backend of the exact Agent at event time through
 * {@link serviceForAgent}, falling back to the Host plane for compositions (the
 * headless, ACP, and SDK bundles) that do mount it there.
 *
 * @module @indexyz/dsh-autocompact
 */
import z from "@deepseek-ai/schemastery";
import { serviceForAgent } from "@deepseek-ai/dsh-agent-preset-registry";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CompactionEngine } from "@deepseek-ai/dsh-compaction";
import type { CommandInvocation, CommandResult } from "@deepseek-ai/dsh-commands";
import type { Session } from "@deepseek-ai/dsh-session";
import { needsCompaction, selectCompactableRange } from "./compaction.ts";
import {
  defaultLimits,
  modelKey,
  nativeAutoEnabled,
  nativePolicy,
  nativeRetainTokens,
  parseLimit,
  resolveLimit,
  supportsRegions,
  validateLimit,
} from "./settings.ts";

/** Plugin identity used by the Loader and by diagnostics. */
export const name = "autocompact";

/** Host-plane services this plugin needs before it can register its command and hook. */
export const inject = ["commands", "tokenMeter", "llm"];

/** A `.volatile()` Config field: the Loader parses it into a stable reference read with `get()`. */
export interface VolatileField<T> {
  get(): T | undefined;
}

/**
 * Row configuration as `apply` receives it.
 *
 * The two fields the Settings page writes are declared `.volatile()`, so the
 * Loader hands `apply` live references rather than plain values; a direct call
 * (tests, embedding) may still pass plain values.
 */
export interface AutocompactConfig {
  /** Optional global default thresholds keyed by exact `provider/model`. Never written by the command. */
  modelLimits?: Record<string, number> | VolatileField<Record<string, number>>;
  /** Recent-tail fallback budget used only when the backend publishes no retention policy. */
  retainTokens?: number;
  /** Master switch for the automatic pressure check. */
  enabled?: boolean | VolatileField<boolean>;
}

/**
 * Validated row configuration; misconfiguration fails plugin load.
 *
 * `modelLimits` and `enabled` are volatile because the Settings page edits them
 * through the Host settings service: that service only exposes an entry whose
 * schema declares a volatile field (`volatileForm`), and only accepts writes to
 * volatile paths. A volatile field is also what makes an edit visible to the
 * running plugin without a restart. `retainTokens` stays ordinary configuration,
 * editable from `cordis.patch.yml` only.
 */
export const Config = z.object({
  modelLimits: z.dict(z.natural()).default({}).volatile(),
  retainTokens: z.natural().default(20000),
  enabled: z.boolean().default(true).volatile(),
});

interface Target {
  readonly provider: string;
  readonly model: string;
}

/**
 * Read one Config field, whether the Loader handed over a volatile reference or
 * a plain value, and re-read it on every call so a live Settings write is
 * visible to the running plugin.
 *
 * @param field - the parsed field, a volatile reference, or `undefined`.
 * @param fallback - value used when the field is absent or its reference is empty.
 * @returns the current plain value.
 */
function liveValue<T>(field: T | VolatileField<T> | undefined, fallback: T): T {
  if (field === undefined) return fallback;
  if (typeof field === "object" && field !== null) {
    const reference = field as VolatileField<T>;
    if (typeof reference.get === "function") return reference.get() ?? fallback;
  }
  return field as T;
}

interface SessionState {
  readonly overrides: Map<string, number | null>;
  readonly warned: Set<string>;
}

interface RouteInfo {
  readonly target: Target;
  readonly key: string;
  readonly contextWindow: number | undefined;
  readonly retainTokens: number;
}

/** Resolve the exact routed route for one agent, mirroring the backend's own lookup. */
export function targetOf(agent: Agent): Target | undefined {
  const header = agent.session.requestHeader()?.config;
  if (header !== undefined && header.provider.length > 0 && header.model.length > 0) {
    return { provider: header.provider, model: header.model };
  }
  const options = agent.options;
  if (
    typeof options?.provider === "string" &&
    options.provider.length > 0 &&
    typeof options.model === "string" &&
    options.model.length > 0
  ) {
    return { provider: options.provider, model: options.model };
  }
  return undefined;
}

/**
 * Resolve the compaction backend serving one Agent.
 *
 * A preset-mounted backend is isolated to that Agent's preset realm, so the
 * Agent's own identity is the only key that reaches it; compositions that mount
 * a backend on the Host plane are served by the direct lookup instead.
 *
 * @param ctx - this plugin's Host-plane context.
 * @param agent - the Agent whose backend is requested.
 * @returns the backend, or `undefined` when this composition mounts none.
 */
export function backendFor(ctx: Context, agent: Agent): CompactionEngine | undefined {
  try {
    const mounted = serviceForAgent(ctx, agent, "compaction");
    if (mounted !== undefined) return mounted;
  } catch {
    // A torn-down scope or an absent preset runtime leaves only the Host plane.
  }
  return ctx.get("compaction");
}

/**
 * Register the session-only `/autocompact` command and the automatic pressure
 * check for every Agent.
 *
 * @param ctx - Host-plane context carrying the command registry, the token meter, and the LLM registry.
 * @param config - validated row configuration; the Settings-editable fields arrive as live references.
 */
export function apply(ctx: Context, config: AutocompactConfig = {}): void {
  /** Current global defaults, re-read so a Settings write applies to the running plugin. */
  const limitsNow = (): Map<string, number> =>
    defaultLimits({ modelLimits: liveValue(config.modelLimits, {}) });
  const fallbackRetainTokens = liveValue(config.retainTokens, 20000);
  // Validate the configured defaults at load, where a bad row fails loudly,
  // instead of at the first measured step.
  limitsNow();
  // Session-only state, keyed by the live Session object so a new, resumed, or
  // forked session starts clean and a detached session is collected.
  const sessions = new WeakMap<Session, SessionState>();

  const stateOf = (session: Session): SessionState => {
    let state = sessions.get(session);
    if (state === undefined) {
      state = { overrides: new Map(), warned: new Set() };
      sessions.set(session, state);
    }
    return state;
  };

  const warnOnce = (session: Session, message: string): void => {
    const { warned } = stateOf(session);
    if (warned.has(message)) return;
    warned.add(message);
    ctx.logger.warn(`autocompact: ${message}`);
  };

  /** Resolve the exact route, its real window, and the backend's retained-tail budget. */
  const routeInfo = async (
    agent: Agent,
    backend: CompactionEngine,
    signal?: AbortSignal,
  ): Promise<RouteInfo | undefined> => {
    const target = targetOf(agent);
    if (target === undefined) return undefined;
    const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    const contextWindow = info.context?.contextWindow;
    const reserved = agent.session.requestHeader()?.config.maxTokens ?? info.defaultMaxTokens ?? 0;
    return {
      target,
      key: modelKey(target.provider, target.model),
      contextWindow,
      retainTokens:
        contextWindow === undefined
          ? fallbackRetainTokens
          : nativeRetainTokens(
              nativePolicy(backend),
              target.provider,
              target.model,
              contextWindow,
              reserved,
              fallbackRetainTokens,
            ),
    };
  };

  /**
   * Compact an explicit balanced range once the session crosses its effective
   * threshold. Failures are contained: the turn continues untouched, exactly
   * like the backend's own automatic pressure path.
   */
  const checkPressure = async (agent: Agent, signal: AbortSignal): Promise<void> => {
    if (!liveValue(config.enabled, true) || signal.aborted) return;
    const target = targetOf(agent);
    if (target === undefined) return;
    const key = modelKey(target.provider, target.model);
    const limit = resolveLimit(stateOf(agent.session).overrides, limitsNow(), key);
    if (limit === undefined) return;
    const backend = backendFor(ctx, agent);
    if (backend === undefined || !nativeAutoEnabled(backend)) return;
    const measurement = ctx.tokenMeter.measure(agent.session);
    if (!needsCompaction(measurement, limit)) return;
    if (!supportsRegions(backend)) {
      warnOnce(
        agent.session,
        "the mounted compaction backend does not support compactRegion; thresholds have no effect",
      );
      return;
    }
    const route = await routeInfo(agent, backend, signal);
    if (route === undefined || route.contextWindow === undefined) {
      warnOnce(
        agent.session,
        `no context capacity for ${key}; configure contextWindow on that adapter model`,
      );
      return;
    }
    if (signal.aborted) return;
    validateLimit(limit, route.contextWindow, route.retainTokens);
    const range = selectCompactableRange(agent.session, measurement, route.retainTokens);
    if (range === undefined) return;
    ctx.logger.info(
      `autocompact: compacting ${key} above ${limit.toLocaleString("en-US")} tokens (${measurement.totalTokens.toLocaleString("en-US")} measured)`,
    );
    await backend.compactRegion(range.start, range.end, agent, signal);
  };

  ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    try {
      await checkPressure(agent, signal);
    } catch (error) {
      if (!signal.aborted) {
        warnOnce(
          agent.session,
          `compaction failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return next();
  });

  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const { agent, rawInput, signal } = invocation;
    try {
      const target = targetOf(agent);
      if (target === undefined) return { kind: "error", text: "No model selected" };
      const key = modelKey(target.provider, target.model);
      const backend = backendFor(ctx, agent);
      if (backend === undefined) {
        return { kind: "error", text: `No compaction backend is mounted for ${key}` };
      }
      if (!supportsRegions(backend)) {
        return {
          kind: "error",
          text: "Autocompact requires a compaction backend that supports compactRegion (dsh-compaction 0.2.0-rc.2 or newer)",
        };
      }
      const nativeOff = !nativeAutoEnabled(backend);
      const route = await routeInfo(agent, backend, signal);
      if (route === undefined || route.contextWindow === undefined) {
        return {
          kind: "error",
          text: `No context capacity for ${key}; configure contextWindow on that adapter model`,
        };
      }
      const input = rawInput.trim().toLowerCase();
      const state = stateOf(agent.session).overrides;
      if (input === "off") state.set(key, null);
      else if (input === "default") state.delete(key);
      else if (input) {
        const limit = parseLimit(input);
        validateLimit(limit, route.contextWindow, route.retainTokens);
        if (nativeOff) {
          return {
            kind: "error",
            text: "Automatic compaction is disabled by the compaction backend. Enable it before setting a threshold.",
          };
        }
        state.set(key, limit);
      }
      const limit = resolveLimit(state, limitsNow(), key);
      const source = state.has(key) ? "session" : "global default";
      const threshold =
        limit === undefined
          ? "backend default compaction (no plugin threshold)"
          : `autocompact above ${limit.toLocaleString("en-US")} tokens (${source})`;
      return {
        kind: "success",
        text: `${key}: ${threshold}. Native automatic compaction: ${nativeOff ? "disabled" : "enabled"}. No configuration written.`,
      };
    } catch (error) {
      return { kind: "error", text: error instanceof Error ? error.message : String(error) };
    }
  };

  ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: CommandDefinitionId("@indexyz/dsh-autocompact"),
        name: "autocompact",
        description:
          "Session-only per-model compaction threshold: /autocompact [300k | off | default]",
        input: { hint: "300k | off | default" },
        handler,
      }),
    "dsh-autocompact command",
  );
}
