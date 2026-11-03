import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import { CacheStore, cachePath, modelsDevCachePath } from "./cache.ts";
import { getConfigPath, loadProviders } from "./config.ts";
import {
  cachedProviderModels,
  credentialApiKey,
  discoverProvider,
  modelConfigForProvider,
  providerConfig,
  applyProviderHeuristics,
} from "./discovery.ts";
import {
  cachedModelsDevCatalog,
  emptyModelsDevCatalog,
  enrichWithModelsDev,
  loadModelsDevCatalog,
} from "./models-dev.ts";
import type { DiscoveredModel, ModelsDevCatalog, ProviderDefinition } from "./types.ts";

export { mapThinkingLevels, thinkingFromSuffix, variantKey } from "./thinking.ts";
export { parseDiscoveredModel } from "./model-metadata.ts";
export { parseRootConfig } from "./config.ts";

type RefreshContext = Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0];

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
  const { root, providers } = loaded;

  const controller = new AbortController();
  const store = new CacheStore();
  const modelsDevPath = modelsDevCachePath(root.modelsDev, root.cache);
  const providerPath = (provider: ProviderDefinition) => cachePath(provider, root.cache);

  // Upstream models before enrichment, so a new models.dev catalog can be applied again.
  const upstreamModels = new Map<string, DiscoveredModel[]>();
  const discoveredModels = new Map<string, DiscoveredModel[]>();
  let modelsDev: ModelsDevCatalog = emptyModelsDevCatalog();

  const register = (provider: ProviderDefinition) => {
    pi.registerProvider(
      provider.name,
      providerConfig(provider, discoveredModels.get(provider.name) ?? [], (context) =>
        refreshProviderModels(provider, context),
      ),
    );
  };
  const setModels = (provider: ProviderDefinition, models: DiscoveredModel[]) => {
    upstreamModels.set(provider.name, models);
    discoveredModels.set(
      provider.name,
      models.map((model) =>
        applyProviderHeuristics(provider, enrichWithModelsDev(provider, model, modelsDev)),
      ),
    );
  };
  const fetchProvider = async (
    provider: ProviderDefinition,
    signal: AbortSignal,
    forceRefresh: boolean,
  ) => {
    const path = providerPath(provider);
    return discoverProvider(
      provider,
      await store.read(path),
      () => store.write(path),
      signal,
      forceRefresh,
    );
  };
  const fetchModelsDev = async (signal: AbortSignal, forceRefresh: boolean) =>
    loadModelsDevCatalog(
      root.modelsDev,
      await store.read(modelsDevPath),
      () => store.write(modelsDevPath),
      signal,
      forceRefresh,
    );

  // Startup registers every matching cache, however old, and waits only for
  // sources that have nothing cached. Expired sources refresh after
  // session_start (refreshExpired), so a slow upstream never delays startup.
  const expiredProviders: ProviderDefinition[] = [];
  const cachedCatalog = cachedModelsDevCatalog(root.modelsDev, await store.read(modelsDevPath));
  const modelsDevExpired = cachedCatalog?.expired === true;
  const [catalog, startupModels] = await Promise.all([
    cachedCatalog ? cachedCatalog.catalog : fetchModelsDev(controller.signal, false),
    Promise.all(
      providers.map(async (provider) => {
        const cached = cachedProviderModels(provider, await store.read(providerPath(provider)));
        if (!cached) return fetchProvider(provider, controller.signal, false);
        if (cached.expired) expiredProviders.push(provider);
        return cached.models;
      }),
    ),
  ]);
  modelsDev = catalog;
  providers.forEach((provider, index) => setModels(provider, startupModels[index] ?? []));

  const refreshProviderModels = async (provider: ProviderDefinition, context: RefreshContext) => {
    // Pi's own offline refresh (run while it sets up every session) gets the
    // models already registered instead of a second enrichment pass.
    if (!context.allowNetwork) {
      return (discoveredModels.get(provider.name) ?? []).map((model) =>
        modelConfigForProvider(provider, model),
      );
    }
    const credentialKey = credentialApiKey(context.credential);
    const effective = credentialKey ? { ...provider, apiKey: credentialKey } : provider;
    const force = context.force === true;
    const models = await fetchProvider(effective, context.signal, force);
    if (provider.useModelsDev) modelsDev = await fetchModelsDev(context.signal, force);
    setModels(provider, models);
    return (discoveredModels.get(provider.name) ?? []).map((model) =>
      modelConfigForProvider(provider, model),
    );
  };

  for (const provider of providers) register(provider);

  const refreshExpired = async () => {
    const { signal } = controller;
    const [catalogUpdate, refreshed] = await Promise.all([
      modelsDevExpired ? fetchModelsDev(signal, false) : undefined,
      Promise.all(
        expiredProviders.map(
          async (provider) => [provider, await fetchProvider(provider, signal, false)] as const,
        ),
      ),
    ]);
    if (signal.aborted) return;
    const changed = new Set(refreshed.map(([provider]) => provider.name));
    if (catalogUpdate) {
      modelsDev = catalogUpdate;
      for (const provider of providers) if (provider.useModelsDev) changed.add(provider.name);
    }
    for (const [provider, models] of refreshed) upstreamModels.set(provider.name, models);
    for (const provider of providers) {
      if (!changed.has(provider.name)) continue;
      setModels(provider, upstreamModels.get(provider.name) ?? []);
      register(provider);
    }
  };

  // Pi may load extensions without starting a session, so background network
  // work waits for the first session_start of this extension instance.
  let refreshStarted = false;
  pi.on("session_start", () => {
    if (refreshStarted) return;
    refreshStarted = true;
    if (!modelsDevExpired && expiredProviders.length === 0) return;
    void refreshExpired().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("[custom-provider] background model refresh failed:", error);
      }
    });
  });

  // Inject a per-request session-affinity header (e.g. x-session-id) carrying
  // pi's session UUID, matching the provider's expected affinity scheme. The
  // hook also applies to retried requests.
  const affinityHeaders = new Map(
    providers.flatMap((provider) =>
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
      const { signal } = controller;
      const [catalogUpdate, refreshed] = await Promise.all([
        fetchModelsDev(signal, true),
        Promise.all(providers.map((provider) => fetchProvider(provider, signal, true))),
      ]);
      modelsDev = catalogUpdate;
      providers.forEach((provider, index) => {
        setModels(provider, refreshed[index] ?? []);
        register(provider);
      });
      ctx.ui.notify("Custom provider models refreshed", "info");
    },
  });

  pi.on("session_shutdown", () => {
    controller.abort();
  });
}
