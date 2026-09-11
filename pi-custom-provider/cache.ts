import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expandPath, getAgentDir } from "./config.ts";
import { DEFAULT_CACHE_FILENAME } from "./types.ts";
import type {
  CacheDocument,
  CachedProviderModels,
  CacheOptions,
  ModelsDevOptions,
  ProviderDefinition,
} from "./types.ts";
import { asRecord } from "./util.ts";

export function cacheKey(provider: ProviderDefinition) {
  return JSON.stringify({
    api: provider.api,
    baseURL: provider.baseURL,
    modelsURL: provider.modelsURL,
  });
}

export function emptyCache(): CacheDocument {
  return { version: 1, providers: {} };
}

export async function readCache(path: string): Promise<CacheDocument> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const record = asRecord(parsed);
    const providers = asRecord(record?.providers);
    if (record?.version !== 1 || !providers) return emptyCache();
    const modelsDevRecord = asRecord(record?.modelsDev);
    const modelsDevProviders = asRecord(modelsDevRecord?.providers);
    const modelsDevModels = asRecord(modelsDevRecord?.models);
    const modelsDev =
      modelsDevRecord &&
      Number.isFinite(modelsDevRecord.fetchedAt) &&
      modelsDevProviders &&
      modelsDevModels
        ? {
            fetchedAt: modelsDevRecord.fetchedAt as number,
            cacheKey:
              typeof modelsDevRecord.cacheKey === "string" ? modelsDevRecord.cacheKey : undefined,
            providers: modelsDevProviders,
            models: modelsDevModels,
          }
        : undefined;
    return {
      version: 1,
      providers: providers as Record<string, CachedProviderModels>,
      ...(modelsDev ? { modelsDev } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[custom-provider] failed to read cache ${path}:`, error);
    }
    return emptyCache();
  }
}

export async function writeCache(path: string, cache: CacheDocument) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function modelsDevCachePath(options: ModelsDevOptions, rootCache: Partial<CacheOptions>) {
  const configured = options.file ?? rootCache.file ?? DEFAULT_CACHE_FILENAME;
  return expandPath(configured, getAgentDir());
}

export function cachePath(provider: ProviderDefinition, rootCache: Partial<CacheOptions>) {
  const configured = provider.cache.file ?? rootCache.file ?? DEFAULT_CACHE_FILENAME;
  return expandPath(configured, getAgentDir());
}
