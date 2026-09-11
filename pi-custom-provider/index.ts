import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import { cachePath, modelsDevCachePath, readCache } from "./cache.ts";
import { getConfigPath, loadProviders } from "./config.ts";
import {
  credentialApiKey,
  discoverProvider,
  modelConfigForProvider,
  providerConfig,
  applyProviderHeuristics,
} from "./discovery.ts";
import { enrichWithModelsDev, loadModelsDevCatalog } from "./models-dev.ts";
import type {
  CacheDocument,
  DiscoveredModel,
  ModelsDevCatalog,
  ProviderDefinition,
} from "./types.ts";

export { mapThinkingLevels, thinkingFromSuffix, variantKey } from "./thinking.ts";
export { parseDiscoveredModel } from "./model-metadata.ts";
export { parseRootConfig } from "./config.ts";

export default async function customProviderExtension(pi: ExtensionAPI) {
  const configPath = getConfigPath();
  let loaded: Awaited<ReturnType<typeof loadProviders>>;
  try {
    loaded = await loadProviders(configPath);
  } catch (error) {
    console.error(`[custom-provider] failed to load ${configPath}:`, error);
    return;
  }
  if (loaded.providers.length === 0) return;

  const controller = new AbortController();
  const cacheDocuments = new Map<string, CacheDocument>();
  const discoveredModels = new Map<string, DiscoveredModel[]>();

  const discoverAll = async (forceRefresh: boolean) => {
    // Process providers serially so providers sharing the default cache file do
    // not overwrite each other's atomic writes with stale in-memory documents.
    const modelsDevPath = modelsDevCachePath(loaded.root.modelsDev, loaded.root.cache);
    let modelsDevCache = cacheDocuments.get(modelsDevPath);
    if (!modelsDevCache) {
      modelsDevCache = await readCache(modelsDevPath);
      cacheDocuments.set(modelsDevPath, modelsDevCache);
    }
    const modelsDev = await loadModelsDevCatalog(
      loaded.root.modelsDev,
      modelsDevCache,
      modelsDevPath,
      controller.signal,
      forceRefresh,
    );
    for (const provider of loaded.providers) {
      const path = cachePath(provider, loaded.root.cache);
      let cache = cacheDocuments.get(path);
      if (!cache) {
        cache = await readCache(path);
        cacheDocuments.set(path, cache);
      }
      const models = await discoverProvider(provider, cache, path, controller.signal, forceRefresh);
      discoveredModels.set(
        provider.name,
        models.map((model) =>
          applyProviderHeuristics(provider, enrichWithModelsDev(provider, model, modelsDev)),
        ),
      );
    }
  };

  await discoverAll(false);

  const refreshProviderModels = async (
    provider: ProviderDefinition,
    context: Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0],
  ) => {
    const credentialKey = credentialApiKey(context.credential);
    const effective = credentialKey ? { ...provider, apiKey: credentialKey } : provider;
    const path = cachePath(provider, loaded.root.cache);
    let cache = cacheDocuments.get(path);
    if (!cache) {
      cache = await readCache(path);
      cacheDocuments.set(path, cache);
    }
    const force = context.force === true;
    const models = context.allowNetwork
      ? await discoverProvider(effective, cache, path, context.signal, force)
      : (cache.providers[provider.name]?.models ?? provider.fallbackModels);
    let catalog: ModelsDevCatalog = { providers: {}, models: {} };
    if (provider.useModelsDev) {
      const modelsDevPath = modelsDevCachePath(loaded.root.modelsDev, loaded.root.cache);
      let modelsDevCache = cacheDocuments.get(modelsDevPath);
      if (!modelsDevCache) {
        modelsDevCache = await readCache(modelsDevPath);
        cacheDocuments.set(modelsDevPath, modelsDevCache);
      }
      catalog = await loadModelsDevCatalog(
        loaded.root.modelsDev,
        modelsDevCache,
        modelsDevPath,
        context.signal,
        context.allowNetwork ? force : false,
      );
    }
    const enriched = models.map((model) =>
      applyProviderHeuristics(provider, enrichWithModelsDev(provider, model, catalog)),
    );
    discoveredModels.set(provider.name, enriched);
    return enriched.map((model) => modelConfigForProvider(provider, model));
  };

  const registerAll = () => {
    for (const provider of loaded.providers) {
      pi.registerProvider(
        provider.name,
        providerConfig(provider, discoveredModels.get(provider.name) ?? [], (context) =>
          refreshProviderModels(provider, context),
        ),
      );
    }
  };
  registerAll();

  // Inject a per-request session-affinity header (e.g. x-session-id) carrying
  // pi's session UUID, matching the provider's expected affinity scheme. The
  // hook also applies to retried requests.
  const affinityHeaders = new Map(
    loaded.providers.flatMap((provider) =>
      provider.sessionAffinityHeader
        ? [[provider.name, provider.sessionAffinityHeader] as const]
        : [],
    ),
  );
  if (affinityHeaders.size > 0) {
    pi.on("before_provider_headers", (event, ctx) => {
      const headerName = ctx.model?.provider ? affinityHeaders.get(ctx.model.provider) : undefined;
      if (!headerName) return;
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (sessionId) event.headers[headerName] = sessionId;
    });
  }

  pi.registerCommand("refresh-custom-provider-models", {
    description: "Refresh model catalogs for custom providers",
    handler: async (_args, ctx) => {
      await discoverAll(true);
      registerAll();
      ctx.ui.notify("Custom provider models refreshed", "info");
    },
  });

  pi.on("session_shutdown", () => {
    controller.abort();
  });
}
