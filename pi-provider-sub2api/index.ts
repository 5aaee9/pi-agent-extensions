import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import { registerCodexCompaction } from "./codex-compaction.ts";
import { escapeConfigLiteral, getConfigPath, loadRelayConfigs } from "./config.ts";
import { fetchModels } from "./discovery.ts";
import { refreshActiveQuota, renderUsageFooter } from "./footer.ts";
import type { UsageFooterColor, UsageFooterLine } from "./footer.ts";
import {
  getApiBaseUrl,
  getBuiltinModelMetadata,
  getDefaultMaxTokens,
  getModelApi,
  getModelCompat,
  getThinkingLevelMap,
  loadCachedModelMetadata,
  scaleModelCost,
} from "./model-metadata.ts";
import { refreshBilling, refreshQuota } from "./quota.ts";
import { addFastServiceTier, addServerTools, streamCodex } from "./relay-stream.ts";
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
import type { DiscoveredModel, RelayConfig, SupportedApi } from "./types.ts";
import { firstMaxTokensWithinContext, sanitizeDisplayString } from "./util.ts";

export default async function (pi: ExtensionAPI) {
  const configPath = getConfigPath();
  let relays: RelayConfig[];
  try {
    relays = await loadRelayConfigs(configPath);
  } catch (error) {
    console.error(`[sub2api] failed to load ${configPath}:`, error);
    return;
  }

  const generation = nextExtensionGeneration();
  const lifecycleController = new AbortController();
  let active = true;
  const isCurrent = () =>
    active && isExtensionGeneration(generation) && !lifecycleController.signal.aborted;

  let usageFooterLine: UsageFooterLine | undefined;
  let requestFooterRender: (() => void) | undefined;
  let ultraEnabled = false;
  let fastEnabled = false;
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
        render: (width: number) =>
          renderUsageFooter(
            ctx,
            footerData,
            theme,
            usageFooterLine,
            ultraEnabled,
            fastEnabled,
            width,
          ),
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

  registerCodexCompaction(pi, (provider) => relaysByProvider.get(provider));

  const [providers, cachedModelMetadata] = await Promise.all([
    Promise.all(
      relays.map(async (relay) => {
        const [models] = await Promise.all([fetchModels(relay), refreshRelayBilling(relay)]);
        return { relay, models };
      }),
    ),
    loadCachedModelMetadata(),
  ]);

  const discoveredModelsByProvider = new Map(
    providers.map(({ relay, models }) => [relay.provider, models]),
  );
  const registeredPriceMultipliers = new Map<string, number>();
  const registerRelayProvider = (relay: RelayConfig, models: DiscoveredModel[]) => {
    const priceMultiplier = billingByProvider.get(relay.provider)?.effectiveRateMultiplier ?? 1;
    const registeredModels: ProviderModelConfig[] = models
      .filter((model) => !EXCLUDED.test(model.id))
      .map((model) => {
        const api = getModelApi(model.id, relay.api);
        const reasoning = model.reasoning ?? REASONING.test(model.id);
        const builtinMetadata = getBuiltinModelMetadata(model.id, api, cachedModelMetadata);
        // Keep Anthropic's relay-safe limits: pi's native catalog can advertise a
        // larger output cap than some Sub2API deployments accept. Its pricing is
        // still authoritative when available.
        const builtinLimits = api === "anthropic-messages" ? undefined : builtinMetadata;
        const contextWindow = model.contextWindow ?? builtinLimits?.contextWindow ?? 200000;
        const defaultMaxTokens = Math.min(getDefaultMaxTokens(model.id), contextWindow);
        const maxTokens =
          firstMaxTokensWithinContext(contextWindow, model.maxTokens, builtinLimits?.maxTokens) ??
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

  pi.registerCommand("toggle-ultra", {
    description: "Toggle upstream ultra reasoning for max thinking requests",
    handler: async (_args, ctx) => {
      ultraEnabled = !ultraEnabled;
      for (const { relay, models } of providers) {
        registerRelayProvider(relay, models);
      }
      pi.setThinkingLevel("max");
      requestFooterRender?.();
      ctx.ui.notify(ultraEnabled ? "Ultra reasoning enabled" : "Ultra reasoning disabled", "info");
    },
  });

  pi.registerCommand("toggle-fast", {
    description: "Toggle OpenAI priority service tier for faster responses",
    handler: async (_args, ctx) => {
      fastEnabled = !fastEnabled;
      requestFooterRender?.();
      ctx.ui.notify(fastEnabled ? "Fast mode enabled" : "Fast mode disabled", "info");
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    return addServerTools(event.payload, ctx.model);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastEnabled) return;
    return addFastServiceTier(event.payload, ctx.model);
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
