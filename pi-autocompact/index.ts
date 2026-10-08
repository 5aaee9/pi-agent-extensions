import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  VERSION,
  type BoundaryState,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { summarizeBoundary } from "./compaction.ts";
import {
  defaultLimits,
  effectiveCompaction,
  parseLimit,
  readSettings,
  supportsBoundaries,
  validateLimit,
} from "./settings.ts";

export default function piAutocompact(pi: ExtensionAPI) {
  // Never append these to the session or write settings. null explicitly
  // suppresses a global plugin default for this model until the session ends.
  const overrides = new Map<string, number | null>();
  let defaults = new Map<string, number>();
  let active: AbortController | undefined;
  let shutdown = false;
  let attemptedLeaf: string | null | undefined;
  const supported = supportsBoundaries(VERSION);

  const keyOf = (ctx: ExtensionContext) => ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
  const limitOf = (key: string) =>
    overrides.has(key) ? (overrides.get(key) ?? undefined) : defaults.get(key);

  const nativeSettings = async (ctx: ExtensionContext, key: string) => {
    const global = await readSettings(join(getAgentDir(), "settings.json"));
    const project = ctx.isProjectTrusted()
      ? await readSettings(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"))
      : {};
    return effectiveCompaction(global, project, key);
  };

  pi.on("session_start", async (_event, ctx) => {
    shutdown = false;
    overrides.clear();
    attemptedLeaf = undefined;
    defaults.clear();
    try {
      const global = await readSettings(join(getAgentDir(), "settings.json"));
      defaults = defaultLimits(global);
    } catch (error) {
      ctx.ui.notify(
        `Autocompact settings: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", () => {
    shutdown = true;
    active?.abort();
    overrides.clear();
    defaults.clear();
  });

  // Use Pi's actionable boundaries, rather than ctx.compact() inside turn_end
  // (manual compaction aborts the run). Returning a compaction draft preserves
  // the ordinary tool/follow-up continuation without injecting a user prompt.
  const checkBoundary = async (event: BoundaryState, ctx: ExtensionContext) => {
    if (!supported || shutdown || active || ctx.signal?.aborted) return;
    const key = keyOf(ctx);
    if (!key || !ctx.model) return;
    const limit = limitOf(key);
    if (limit === undefined) return;
    const tokens = ctx.getContextUsage()?.tokens;
    if (tokens === undefined || tokens === null || tokens <= limit) return;
    const leaf = ctx.sessionManager.getLeafId();
    if (leaf === attemptedLeaf) return;
    attemptedLeaf = leaf;
    try {
      const settings = await nativeSettings(ctx, key);
      if (!settings.enabled) return;
      validateLimit(limit, ctx.model.contextWindow, settings.keepRecentTokens);
      const controller = new AbortController();
      active = controller;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(180000),
        ...(ctx.signal ? [ctx.signal] : []),
      ]);
      ctx.ui.setStatus("autocompact", `Compacting above ${limit.toLocaleString("en-US")} tokens…`);
      const entry = await summarizeBoundary(event.context, ctx, settings, signal);
      if (signal.aborted) return;
      if (entry) return { entries: [entry] };
    } catch (error) {
      if (!shutdown && !ctx.signal?.aborted && !active?.signal.aborted) {
        ctx.ui.notify(
          `Autocompact failed: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    } finally {
      active = undefined;
      if (!shutdown) ctx.ui.setStatus("autocompact", undefined);
    }
  };
  pi.on("turn_end", checkBoundary);
  pi.on("agent_before_settle", checkBoundary);

  // Idle input can also compact before a large existing session's next prompt.
  // This path uses native compaction, including session_before_compact hooks.
  pi.on("input", async (_event, ctx) => {
    if (!supported || shutdown || !ctx.isIdle() || active) return;
    const key = keyOf(ctx);
    if (!key || !ctx.model) return;
    const limit = limitOf(key);
    const tokens = ctx.getContextUsage()?.tokens;
    if (limit === undefined || tokens === undefined || tokens === null || tokens <= limit) return;
    try {
      const settings = await nativeSettings(ctx, key);
      if (!settings.enabled) return;
      validateLimit(limit, ctx.model.contextWindow, settings.keepRecentTokens);
      await new Promise<void>((resolve, reject) => {
        ctx.compact({ onComplete: () => resolve(), onError: reject });
      });
    } catch (error) {
      ctx.ui.notify(
        `Autocompact failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });

  pi.registerCommand("autocompact", {
    description: "Session-only compaction threshold: /autocompact [300k | off | default]",
    handler: async (args, ctx) => {
      try {
        if (!supported) throw new Error("pi-autocompact requires Pi 0.87.1 or newer");
        await ctx.waitForIdle();
        const key = keyOf(ctx);
        if (!key || !ctx.model) throw new Error("No model selected");
        const input = args.trim().toLowerCase();
        const settings = await nativeSettings(ctx, key);
        if (input === "off") overrides.set(key, null);
        else if (input === "default") overrides.delete(key);
        else if (input) {
          const limit = parseLimit(input);
          validateLimit(limit, ctx.model.contextWindow, settings.keepRecentTokens);
          if (!settings.enabled)
            throw new Error("Automatic compaction is disabled. Enable it via /settings first.");
          overrides.set(key, limit);
        }
        if (input) attemptedLeaf = undefined;
        const limit = limitOf(key);
        const source = overrides.has(key) ? "session" : "global default";
        ctx.ui.notify(
          `${key}: ${limit === undefined ? "Pi default compaction (no plugin threshold)" : `autocompact above ${limit.toLocaleString("en-US")} tokens (${source})`}. Native automatic compaction: ${settings.enabled ? "enabled" : "disabled"}. No settings written.`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
