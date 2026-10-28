import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import { registerCodexCompaction } from "./codex-compaction.ts";
import { escapeConfigLiteral, getAgentDir, getConfigPath, loadRelayConfigs } from "./config.ts";
import { fetchModels } from "./discovery.ts";
import { loadDiscoveryCache } from "./model-cache.ts";
import { refreshActiveQuota, renderUsageFooter } from "./footer.ts";
import type { UsageFooterColor, UsageFooterLine } from "./footer.ts";
import {
  getApiBaseUrl,
  BUILTIN_MODEL_METADATA,
  getBuiltinModelMetadata,
  getDefaultMaxTokens,
  getModelApi,
  getModelCompat,
  getThinkingLevelMap,
  loadCachedModelMetadata,
  scaleModelCost,
} from "./model-metadata.ts";
import { refreshBilling, refreshQuota } from "./quota.ts";
import { addDaybreakProgram, addServerTools, addServiceTier, streamCodex } from "./relay-stream.ts";
import { createRequestModeStore } from "./request-mode-store.ts";
import {
  createRequestModeState,
  describeRequestModes,
  SERVICE_TIER_WIRE,
  supportsDaybreak,
  supportsRequestModes,
  supportsServiceTier,
} from "./request-modes.ts";
import {
  billingByProvider,
  billingRefreshes,
  EXCLUDED,
  isExtensionGeneration,
  nextExtensionGeneration,
  quotaByProvider,
  quotaRefreshes,
  REASONING,
  relaysByProvider,
} from "./types.ts";
import type {
  DiscoveredModel,
  RelayConfig,
  RequestModes,
  ServiceTierMode,
  SupportedApi,
} from "./types.ts";
import { firstMaxTokensWithinContext, sanitizeDisplayString } from "./util.ts";
import { resolveXaiMetadata } from "./xai.ts";
import { streamXai, XAI_RESPONSES_API } from "./xai-stream.ts";

function isXaiModel(model: { provider: string } | undefined): model is { provider: string } {
  return model !== undefined && relaysByProvider.get(model.provider)?.xai === true;
}

export default async function (pi: ExtensionAPI) {
  const configPath = getConfigPath();
  let relays: RelayConfig[];
  try {
    relays = await loadRelayConfigs(configPath);
  } catch (error) {
    console.error(`[sub2api] failed to load ${configPath}:`, error);
    return;
  }
  if (!XAI_RESPONSES_API) {
    relays = relays.filter((relay) => {
      if (!relay.xai) return true;
      console.error(
        `[sub2api:${relay.provider}] api "xai" requires Pi's OpenAI Responses adapter (Pi 1.4.0 or newer); this entry is disabled`,
      );
      return false;
    });
  }

  const generation = nextExtensionGeneration();
  const lifecycleController = new AbortController();
  let active = true;
  const isCurrent = () =>
    active && isExtensionGeneration(generation) && !lifecycleController.signal.aborted;

  let usageFooterLine: UsageFooterLine | undefined;
  let requestFooterRender: (() => void) | undefined;
  let ultraEnabled = false;
  const requestModes = createRequestModeState();
  const saveRequestModes = createRequestModeStore(configPath);
  const setUsageLine = (
    ctx: ExtensionContext,
    provider: string,
    text: string,
    color: UsageFooterColor = "accent",
  ) => {
    if (!ctx.hasUI || ctx.model?.provider !== provider) return;
    usageFooterLine = { text: sanitizeDisplayString(text, 200), color };
    requestFooterRender?.();
  };
  const clearUsageLine = (_ctx: ExtensionContext) => {
    usageFooterLine = undefined;
    requestFooterRender?.();
  };
  const installUsageFooter = (ctx: ExtensionContext) => {
    // OMP's UI context may lack pi's footer API; skip the quota footer there.
    if (!ctx.hasUI || typeof ctx.ui.setFooter !== "function") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      if (
        typeof footerData.onBranchChange !== "function" ||
        typeof footerData.getGitBranch !== "function" ||
        typeof footerData.getExtensionStatuses !== "function"
      ) {
        return { dispose() {}, invalidate() {}, render: (_width: number) => [] };
      }
      const requestRender = () => tui.requestRender();
      requestFooterRender = requestRender;
      const unsubscribe = footerData.onBranchChange(requestRender);
      return {
        dispose() {
          unsubscribe();
          if (requestFooterRender === requestRender) requestFooterRender = undefined;
        },
        invalidate() {},
        render: (width: number) => {
          const modes = requestModes.active(ctx.model);
          return renderUsageFooter(
            ctx,
            footerData,
            theme,
            usageFooterLine,
            ultraEnabled && !isXaiModel(ctx.model),
            modes.serviceTier === "fast",
            width,
            modes.serviceTier === "ultrafast",
            modes.daybreak === "blue",
          );
        },
      };
    });
  };

  relaysByProvider.clear();
  quotaByProvider.clear();
  billingByProvider.clear();
  quotaRefreshes.clear();
  billingRefreshes.clear();
  for (const relay of relays) relaysByProvider.set(relay.provider, relay);
  const refreshRelayQuota = (relay: RelayConfig) =>
    refreshQuota(
      relay,
      lifecycleController.signal,
      () => isCurrent() && relaysByProvider.get(relay.provider) === relay,
    );
  const refreshRelayBilling = (relay: RelayConfig) =>
    refreshBilling(
      relay,
      lifecycleController.signal,
      () => isCurrent() && relaysByProvider.get(relay.provider) === relay,
    );

  const discoveryCache = await loadDiscoveryCache(getAgentDir());
  const staleRelays: RelayConfig[] = [];
  const [providers, cachedModelMetadata] = await Promise.all([
    Promise.all(
      relays.map(async (relay) => {
        const cached = discoveryCache.get(relay);
        if (cached) {
          // An expired entry still registers immediately. Refresh continues after
          // the factory returns so startup does not wait on discovery.
          if (!cached.fresh) staleRelays.push(relay);
          await refreshRelayBilling(relay);
          return { relay, models: cached.models };
        }
        const [discovery] = await Promise.all([fetchModels(relay), refreshRelayBilling(relay)]);
        if (discovery.ok) {
          try {
            await discoveryCache.store(relay, discovery.models);
          } catch (error) {
            console.error(
              `[sub2api:${relay.provider}] failed to write discovered model cache:`,
              error,
            );
          }
        }
        return { relay, models: discovery.ok ? discovery.models : [] };
      }),
    ),
    loadCachedModelMetadata(),
  ]);

  registerCodexCompaction(
    pi,
    (provider) => relaysByProvider.get(provider),
    (model) => {
      const tier = requestModes.active(model).serviceTier;
      return tier && SERVICE_TIER_WIRE[tier];
    },
    providers.some(({ relay, models }) =>
      models.some(
        (model) =>
          !EXCLUDED.test(model.id) && getModelApi(model.id, relay.api) === "openai-codex-responses",
      ),
    ),
  );

  const discoveredModelsByProvider = new Map(
    providers.map(({ relay, models }) => [relay.provider, models]),
  );
  const registeredPriceMultipliers = new Map<string, number>();
  const registerXaiProvider = (relay: RelayConfig, models: DiscoveredModel[]) => {
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const metadata = resolveXaiMetadata(
          model,
          cachedModelMetadata?.get("xai")?.get(model.id),
          BUILTIN_MODEL_METADATA.get("xai")?.get(model.id),
        );
        return {
          id: model.id,
          name: model.name,
          api: "openai-responses",
          baseUrl: relay.baseUrl,
          reasoning: metadata.reasoning,
          thinkingLevelMap: metadata.thinkingLevelMap,
          input: metadata.input,
          cost: scaleModelCost(metadata.cost, priceMultiplier),
          contextWindow: metadata.contextWindow,
          maxTokens: metadata.maxTokens,
          // Matches Pi's xAI Responses policy: no 24h prompt_cache_retention.
          compat: { supportsLongCacheRetention: false },
        };
      });
    pi.registerProvider(relay.provider, {
      name: relay.provider,
      baseUrl: relay.baseUrl,
      apiKey: escapeConfigLiteral(relay.apiKey),
      api: "openai-responses",
      streamSimple: streamXai,
      models: registeredModels,
    });
    registeredPriceMultipliers.set(relay.provider, priceMultiplier);
  };
  const registerRelayProvider = (relay: RelayConfig, models: DiscoveredModel[]) => {
    if (relay.xai) {
      registerXaiProvider(relay, models);
      return;
    }
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const api = getModelApi(model.id, relay.api);
        const reasoning = model.reasoning ?? REASONING.test(model.id);
        const builtinMetadata = getBuiltinModelMetadata(model.id, api, cachedModelMetadata);
        // Catalog context windows apply to Anthropic too. Only its output cap
        // needs a relay-safe fallback: some Sub2API deployments reject the
        // larger output limits advertised by pi's native catalog.
        const builtinMaxTokens =
          api === "anthropic-messages" ? undefined : builtinMetadata?.maxTokens;
        const contextWindow = model.contextWindow ?? builtinMetadata?.contextWindow ?? 200000;
        const defaultMaxTokens = Math.min(getDefaultMaxTokens(model.id), contextWindow);
        const maxTokens =
          firstMaxTokensWithinContext(contextWindow, model.maxTokens, builtinMaxTokens) ??
          defaultMaxTokens;
        return {
          id: model.id,
          name: model.name,
          api,
          baseUrl: getApiBaseUrl(relay, api),
          reasoning,
          thinkingLevelMap: getThinkingLevelMap(
            reasoning,
            api,
            model.supportedThinkingLevels,
            ultraEnabled,
          ),
          input: model.input ?? ["text", "image"],
          cost: scaleModelCost(builtinMetadata?.cost, priceMultiplier),
          contextWindow,
          maxTokens,
          headers:
            api === "openai-codex-responses"
              ? { Authorization: escapeConfigLiteral(`Bearer ${relay.apiKey}`) }
              : undefined,
          compat: getModelCompat(model.id, api),
        };
      });
    const usesCodex = registeredModels.some((model) => model.api === "openai-codex-responses");
    const defaultApi: SupportedApi =
      relay.api ??
      (usesCodex
        ? "openai-codex-responses"
        : ((registeredModels[0]?.api as SupportedApi | undefined) ?? "openai-responses"));

    pi.registerProvider(relay.provider, {
      name: relay.provider,
      baseUrl: getApiBaseUrl(relay, defaultApi),
      apiKey: escapeConfigLiteral(relay.apiKey),
      api: defaultApi,
      ...(usesCodex ? { streamSimple: streamCodex } : {}),
      models: registeredModels,
    });
    registeredPriceMultipliers.set(relay.provider, priceMultiplier);
  };

  for (const { relay, models } of providers) {
    registerRelayProvider(relay, models);
  }

  // xAI entries do not take part in ultra reasoning or request modes.
  const rejectXaiSelection = (ctx: ExtensionContext, command: string) => {
    if (!isXaiModel(ctx.model)) return false;
    ctx.ui.notify(
      `/${command} is not supported for the selected xAI entry ${ctx.model.provider}.`,
      "warning",
    );
    return true;
  };

  pi.registerCommand("toggle-ultra", {
    description: "Toggle upstream ultra reasoning for max thinking requests",
    handler: async (_args, ctx) => {
      if (rejectXaiSelection(ctx, "toggle-ultra")) return;
      ultraEnabled = !ultraEnabled;
      for (const relay of relays) {
        const models = discoveredModelsByProvider.get(relay.provider);
        if (models) registerRelayProvider(relay, models);
      }
      pi.setThinkingLevel("max");
      requestFooterRender?.();
      ctx.ui.notify(ultraEnabled ? "Ultra reasoning enabled" : "Ultra reasoning disabled", "info");
    },
  });

  const toggleServiceTier = (ctx: ExtensionContext, tier: ServiceTierMode, label: string) => {
    if (rejectXaiSelection(ctx, tier === "fast" ? "toggle-fast" : "toggle-ultrafast")) return;
    const model = ctx.model;
    if (!supportsServiceTier(model, tier)) {
      ctx.ui.notify(`${label} mode is not supported for the selected model.`, "warning");
      return;
    }
    const enabled = requestModes.resolve(model).serviceTier !== tier;
    requestModes.set(model, { serviceTier: enabled ? tier : "default" });
    requestFooterRender?.();
    ctx.ui.notify(`${label} mode ${enabled ? "enabled" : "disabled"} for ${model.id}`, "info");
  };

  pi.registerCommand("toggle-fast", {
    description: "Toggle OpenAI priority service tier for the selected model (not saved)",
    handler: async (_args, ctx) => toggleServiceTier(ctx, "fast", "Fast"),
  });

  pi.registerCommand("toggle-ultrafast", {
    description: "Toggle OpenAI ultrafast service tier for the selected model (not saved)",
    handler: async (_args, ctx) => toggleServiceTier(ctx, "ultrafast", "Ultrafast"),
  });

  pi.registerCommand("toggle-daybreak", {
    description: "Toggle Daybreak Blue access program for the selected model (not saved)",
    handler: async (_args, ctx) => {
      if (rejectXaiSelection(ctx, "toggle-daybreak")) return;
      const model = ctx.model;
      if (!supportsDaybreak(model)) {
        ctx.ui.notify("Daybreak is not supported for the selected model.", "warning");
        return;
      }
      const enabled = requestModes.resolve(model).daybreak !== "blue";
      requestModes.set(model, { daybreak: enabled ? "blue" : "standard" });
      requestFooterRender?.();
      ctx.ui.notify(
        enabled
          ? `Daybreak Blue enabled for ${model.id}`
          : `Daybreak disabled (standard) for ${model.id}`,
        "info",
      );
    },
  });

  pi.registerCommand("sub2api-save", {
    description: "Save the selected model's request modes: [provider] saves provider defaults",
    // Offer nothing once the argument is complete so Enter submits the command.
    getArgumentCompletions: (prefix) =>
      prefix.trim() !== "provider" && "provider".startsWith(prefix.trim())
        ? [{ value: "provider", label: "provider" }]
        : null,
    handler: async (args, ctx) => {
      if (rejectXaiSelection(ctx, "sub2api-save")) return;
      const scope = args.trim();
      if (scope !== "" && scope !== "provider") {
        ctx.ui.notify("Usage: /sub2api-save [provider]", "warning");
        return;
      }
      const model = ctx.model;
      const relay = model && relaysByProvider.get(model.provider);
      if (!relay || !supportsRequestModes(model)) {
        ctx.ui.notify(
          "/sub2api-save requires a selected Sub2API OpenAI model with request-mode support.",
          "warning",
        );
        return;
      }
      const modes = requestModes.resolve(model);
      const target = scope === "provider" ? `${relay.provider} defaults` : `${model.id}`;
      try {
        await saveRequestModes(
          scope === "provider"
            ? { provider: relay.provider }
            : { provider: relay.provider, modelId: model.id },
          modes,
        );
      } catch (error) {
        ctx.ui.notify(
          `Failed to save request modes for ${target}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
      const saved: RequestModes = { ...modes };
      if (scope === "provider") relay.requestModes = saved;
      else relay.modelRequestModes.set(model.id, saved);
      requestFooterRender?.();
      ctx.ui.notify(
        scope === "provider"
          ? `Saved ${describeRequestModes(saved)} as ${target}; model-specific overrides still take precedence.`
          : `Saved ${describeRequestModes(saved)} for ${relay.provider}/${model.id}.`,
        "info",
      );
    },
  });

  let refreshTask: Promise<void> = Promise.resolve();
  const enqueueModelRefresh = (work: () => Promise<void>) => {
    const run = refreshTask.then(work);
    refreshTask = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const refreshDiscoveredModels = async (targets: readonly RelayConfig[]) => {
    const failures: string[] = [];
    const cacheWriteFailures: string[] = [];
    const refreshed: string[] = [];
    for (const relay of targets) {
      const discovery = await fetchModels(relay);
      if (!isCurrent()) return { failures, cacheWriteFailures, refreshed, cancelled: true };
      if (!discovery.ok) {
        failures.push(`${relay.provider}: ${discovery.error.message}`);
        continue;
      }
      try {
        await discoveryCache.store(relay, discovery.models);
      } catch (error) {
        cacheWriteFailures.push(
          `${relay.provider}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!isCurrent()) return { failures, cacheWriteFailures, refreshed, cancelled: true };
      discoveredModelsByProvider.set(relay.provider, discovery.models);
      registerRelayProvider(relay, discovery.models);
      refreshed.push(`${relay.provider} (${discovery.models.length})`);
    }
    return { failures, cacheWriteFailures, refreshed, cancelled: false };
  };
  const describeModelRefresh = (report: Awaited<ReturnType<typeof refreshDiscoveredModels>>) => {
    if (report.failures.length === 0 && report.cacheWriteFailures.length === 0) {
      return {
        message: `Refreshed discovered models for ${report.refreshed.join(", ")}.`,
        level: "info" as const,
      };
    }
    const parts = [
      report.refreshed.length > 0 ? `Updated ${report.refreshed.join(", ")}.` : "",
      report.failures.length > 0
        ? `Kept the last cached models for relays that failed. ${report.failures.join("; ")}`
        : "",
      report.cacheWriteFailures.length > 0
        ? `Could not write the model cache. ${report.cacheWriteFailures.join("; ")}`
        : "",
    ].filter((part) => part.length > 0);
    return { message: parts.join(" "), level: "error" as const };
  };

  pi.registerCommand("sub2api-refresh", {
    description: "Force a refresh of discovered relay models and register them",
    handler: async (_args, ctx) => {
      await enqueueModelRefresh(async () => {
        if (!isCurrent()) return;
        if (relays.length === 0) {
          ctx.ui.notify("No Sub2API relays are configured.", "warning");
          return;
        }
        // The command always fetches, including when the cache is younger than 12 hours.
        const report = await refreshDiscoveredModels(relays);
        if (report.cancelled || !isCurrent()) return;
        const described = describeModelRefresh(report);
        ctx.ui.notify(described.message, described.level);
      });
    },
  });

  if (staleRelays.length > 0) {
    void enqueueModelRefresh(async () => {
      const report = await refreshDiscoveredModels(staleRelays);
      if (report.cancelled || !isCurrent()) return;
      if (report.failures.length === 0 && report.cacheWriteFailures.length === 0) return;
      console.error(
        `[sub2api] background model refresh kept the last cached models. ${describeModelRefresh(report).message}`,
      );
    });
  }

  pi.on("before_provider_request", (event, ctx) => {
    return addServerTools(event.payload, ctx.model);
  });

  pi.on("before_provider_request", (event, ctx) => {
    const { serviceTier, daybreak } = requestModes.active(ctx.model);
    let payload = event.payload;
    if (serviceTier) payload = addServiceTier(payload, ctx.model, serviceTier) ?? payload;
    if (daybreak) payload = addDaybreakProgram(payload, ctx.model, daybreak) ?? payload;
    return payload === event.payload ? undefined : payload;
  });

  const syncRelayProviderPricing = (relay: RelayConfig) => {
    if (!isCurrent()) return;
    const models = discoveredModelsByProvider.get(relay.provider);
    if (!models) return;
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    if (registeredPriceMultipliers.get(relay.provider) === priceMultiplier) return;
    registerRelayProvider(relay, models);
  };
  const refreshRelayBillingAndPricing = async (relay: RelayConfig) => {
    const result = await refreshRelayBilling(relay);
    syncRelayProviderPricing(relay);
    return result;
  };

  pi.on("session_start", (_event, ctx) => {
    installUsageFooter(ctx);
    if (ctx.model) {
      refreshActiveQuota(
        ctx,
        ctx.model.provider,
        refreshRelayQuota,
        refreshRelayBillingAndPricing,
        isCurrent,
        setUsageLine,
        clearUsageLine,
      );
    } else clearUsageLine(ctx);
  });

  pi.on("model_select", (event, ctx) => {
    requestFooterRender?.();
    refreshActiveQuota(
      ctx,
      event.model.provider,
      refreshRelayQuota,
      refreshRelayBillingAndPricing,
      isCurrent,
      setUsageLine,
      clearUsageLine,
    );
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model) {
      refreshActiveQuota(
        ctx,
        ctx.model.provider,
        refreshRelayQuota,
        refreshRelayBillingAndPricing,
        isCurrent,
        setUsageLine,
        clearUsageLine,
      );
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    lifecycleController.abort();
    clearUsageLine(ctx);
  });
}
