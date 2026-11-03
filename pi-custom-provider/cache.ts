import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expandPath, getAgentDir } from "./config.ts";
import { DEFAULT_CACHE_FILENAME } from "./types.ts";
import type {
  CacheDocument,
  CachedProviderModels,
  CacheOptions,
  JsonRecord,
  ModelsDevCatalog,
  ModelsDevOptions,
  ProviderDefinition,
} from "./types.ts";
import { asRecord } from "./util.ts";

/** The models.dev model fields that enrichment reads; everything else is dropped from the cache. */
const MODELS_DEV_MODEL_FIELDS = [
  "name",
  "reasoning",
  "reasoning_options",
  "limit",
  "modalities",
  "cost",
  "pricing",
] as const;

function trimModelsDevModels(models: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(models).map(([id, value]) => {
      const record = asRecord(value);
      if (!record) return [id, value];
      return [
        id,
        Object.fromEntries(
          MODELS_DEV_MODEL_FIELDS.flatMap((field) =>
            record[field] === undefined ? [] : [[field, record[field]]],
          ),
        ),
      ];
    }),
  );
}

/**
 * The full models.dev catalog is several megabytes of descriptions, release
 * dates, and provider docs that enrichment never reads; parsing them dominated
 * startup, so the cache keeps only provider `models` and the fields above.
 */
export function trimModelsDevCatalog(catalog: ModelsDevCatalog): ModelsDevCatalog {
  return {
    providers: Object.fromEntries(
      Object.entries(catalog.providers).map(([id, value]) => {
        const models = asRecord(asRecord(value)?.models);
        return [id, models ? { models: trimModelsDevModels(models) } : {}];
      }),
    ),
    models: trimModelsDevModels(catalog.models),
  };
}

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
            // Trimming a catalog that is already trimmed costs as much as parsing it.
            ...(modelsDevRecord.trimmed === true
              ? { providers: modelsDevProviders, models: modelsDevModels }
              : trimModelsDevCatalog({ providers: modelsDevProviders, models: modelsDevModels })),
            trimmed: true as const,
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
    await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/**
 * One in-memory document per cache file, shared by every provider and the
 * models.dev catalog stored in it. Writes to a file run one at a time, and
 * requests made while a write is waiting collapse into it, so concurrent
 * discoveries always persist the latest document instead of overwriting each
 * other with stale copies.
 */
export class CacheStore {
  readonly #documents = new Map<string, Promise<CacheDocument>>();
  readonly #writes = new Map<string, { tail: Promise<void>; queued?: Promise<void> }>();

  read(path: string): Promise<CacheDocument> {
    let document = this.#documents.get(path);
    if (!document) {
      document = readCache(path);
      this.#documents.set(path, document);
    }
    return document;
  }

  write(path: string): Promise<void> {
    let state = this.#writes.get(path);
    if (!state) {
      state = { tail: Promise.resolve() };
      this.#writes.set(path, state);
    }
    if (state.queued) return state.queued;
    const writeState = state;
    const queued = writeState.tail.then(async () => {
      // From here on, new requests queue behind this write so they include later changes.
      writeState.queued = undefined;
      await writeCache(path, await this.read(path));
    });
    writeState.queued = queued;
    writeState.tail = queued.catch(() => undefined);
    return queued;
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
