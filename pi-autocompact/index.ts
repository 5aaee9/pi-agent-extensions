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
  describeLimit,
  effectiveCompaction,
  effectiveLimit,
  emptyDefaults,
  parseAutocompactCommand,
  readSettings,
  resolveLimit,
  saveLimit,
  supportsBoundaries,
  unusableReason,
  validateLimit,
  type EffectiveLimit,
  type LimitValue,
  type SaveDestination,
} from "./settings.ts";

export default function piAutocompact(pi: ExtensionAPI) {
  // Session overrides are not stored in the transcript. null explicitly
  // suppresses a global plugin default for this model until the session ends.
  // Only `/autocompact <threshold> --save` writes user settings.
  const overrides = new Map<string, LimitValue | null>();
  let defaults = emptyDefaults();
  let active: AbortController | undefined;
  let shutdown = false;
  let attemptedLeaf: string | null | undefined;
  const supported = supportsBoundaries(VERSION);

  const keyOf = (ctx: ExtensionContext) => ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
  const limitOf = (ctx: ExtensionContext, key: string): EffectiveLimit | undefined => {
    if (!ctx.model) return undefined;
    return effectiveLimit(
      {
        session: overrides.has(key) ? overrides.get(key) : undefined,
        model: defaults.models.get(key),
        provider: defaults.providers.get(ctx.model.provider),
        global: defaults.global,
      },
      ctx.model.contextWindow,
    );
  };
  const sourceLabel = (ctx: ExtensionContext, key: string, limit: EffectiveLimit): string => {
    const provider = ctx.model?.provider ?? "";
    const level = (value: LimitValue | null | undefined) =>
      value ? ` ${describeLimit(value)}` : "";
    switch (limit.source) {
      case "session":
        return "session override";
      case "model":
        return `saved model limit${level(defaults.models.get(key))}`;
      case "provider":
        return `provider cap${level(defaults.providers.get(provider))} for ${provider}`;
      case "global":
        return `global cap${level(defaults.global)}`;
      case "window":
        return "context window";
    }
  };

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
    defaults = emptyDefaults();
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
    defaults = emptyDefaults();
  });

  // Use Pi's actionable boundaries, rather than ctx.compact() inside turn_end
  // (manual compaction aborts the run). Returning a compaction draft preserves
  // the ordinary tool/follow-up continuation without injecting a user prompt.
  const checkBoundary = async (event: BoundaryState, ctx: ExtensionContext) => {
    if (!supported || shutdown || active || ctx.signal?.aborted) return;
    const key = keyOf(ctx);
    if (!key || !ctx.model) return;
    const limit = limitOf(ctx, key)?.tokens;
    if (limit === undefined) return;
    const tokens = ctx.getContextUsage()?.tokens;
    if (tokens === undefined || tokens === null || tokens <= limit) return;
    const leaf = ctx.sessionManager.getLeafId();
    if (leaf === attemptedLeaf) return;
    attemptedLeaf = leaf;
    try {
      const settings = await nativeSettings(ctx, key);
      if (!settings.enabled) return;
      // A cap can be unusable for this model (for example a small percentage of
      // a small window). Leave it to native compaction without a warning.
      if (unusableReason(limit, ctx.model.contextWindow, settings.keepRecentTokens)) return;
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
    const limit = limitOf(ctx, key)?.tokens;
    const tokens = ctx.getContextUsage()?.tokens;
    if (limit === undefined || tokens === undefined || tokens === null || tokens <= limit) return;
    try {
      const settings = await nativeSettings(ctx, key);
      if (!settings.enabled) return;
      if (unusableReason(limit, ctx.model.contextWindow, settings.keepRecentTokens)) return;
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

  const saveDestination = (
    target: "model" | "provider" | "global",
    key: string,
    provider: string,
  ): SaveDestination =>
    target === "model"
      ? { target, key }
      : target === "provider"
        ? { target, provider }
        : { target };

  pi.registerCommand("autocompact", {
    description:
      "Compaction threshold: /autocompact [300k | 80% | off | default] [--save | --save-provider | --save-global]",
    handler: async (args, ctx) => {
      try {
        if (!supported) throw new Error("pi-autocompact requires Pi 0.87.1 or newer");
        await ctx.waitForIdle();
        const key = keyOf(ctx);
        const model = ctx.model;
        if (!key || !model) throw new Error("No model selected");
        const parsed = parseAutocompactCommand(args);
        const settings = await nativeSettings(ctx, key);
        if (parsed.kind === "off") overrides.set(key, null);
        else if (parsed.kind === "default") overrides.delete(key);
        else if (parsed.kind === "limit") {
          const capOnly = parsed.save === "provider" || parsed.save === "global";
          // A threshold for this model must be usable as given; a provider or
          // global cap also serves models with other windows.
          if (!capOnly) {
            validateLimit(
              resolveLimit(parsed.value, model.contextWindow),
              model.contextWindow,
              settings.keepRecentTokens,
            );
          }
          if (!settings.enabled)
            throw new Error("Automatic compaction is disabled. Enable it via /settings first.");
          if (parsed.save) {
            await saveLimit(
              join(getAgentDir(), "settings.json"),
              saveDestination(parsed.save, key, model.provider),
              parsed.value,
            );
            if (parsed.save === "model") defaults.models.set(key, parsed.value);
            else if (parsed.save === "provider")
              defaults.providers.set(model.provider, parsed.value);
            else defaults.global = parsed.value;
          }
          if (!capOnly) overrides.set(key, parsed.value);
        }
        if (parsed.kind !== "status") attemptedLeaf = undefined;
        const limit = limitOf(ctx, key);
        let threshold: string;
        if (limit === undefined) {
          threshold =
            overrides.get(key) === null
              ? "Pi default compaction (plugin thresholds off in this session)"
              : "Pi default compaction (no plugin threshold)";
        } else {
          threshold = `autocompact above ${limit.tokens.toLocaleString("en-US")} tokens (${sourceLabel(ctx, key, limit)})`;
          const reason = unusableReason(
            limit.tokens,
            model.contextWindow,
            settings.keepRecentTokens,
          );
          if (reason) threshold += `; not used: ${reason}`;
        }
        const persistence =
          parsed.kind !== "limit" || !parsed.save
            ? "No settings written."
            : parsed.save === "model"
              ? "Saved as the default for this model."
              : parsed.save === "provider"
                ? `Saved as the cap for provider ${model.provider}.`
                : "Saved as the global cap.";
        ctx.ui.notify(
          `${key}: ${threshold}. Native automatic compaction: ${settings.enabled ? "enabled" : "disabled"}. ${persistence}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
