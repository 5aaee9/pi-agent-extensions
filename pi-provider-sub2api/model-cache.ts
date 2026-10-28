import { randomUUID } from "node:crypto";
import { chmod, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { MAX_RESPONSE_BYTES, SUPPORTED_APIS, THINKING_LEVELS, XAI_EFFORTS } from "./types.ts";
import type {
  DiscoveredModel,
  RelayConfig,
  SupportedApi,
  XaiEffort,
  XaiRemoteReasoning,
} from "./types.ts";
import {
  asRecord,
  firstStrictNonNegativeNumber,
  hasControlCharacters,
  isSafeModelId,
  sanitizeDisplayString,
  toPositiveInteger,
} from "./util.ts";

// Relay discovery results, separate from Pi's models-store.json catalog cache.
// Pi's catalog has no Sub2API inventory and no Codex supported_reasoning_levels.
export const DISCOVERY_CACHE_FILENAME = "sub2api-models.json";
export const DISCOVERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

interface StoredEntry {
  baseUrl: string;
  api?: SupportedApi;
  xai: boolean;
  // Absent on entries written before timestamps existed; those count as expired.
  fetchedAt?: number;
  // Absent until a billing lookup succeeds or reports no token-billing contract.
  // Shares fetchedAt with the model list: a young entry that includes it skips
  // another billing request. The effective rate scales registered model prices.
  priceMultiplier?: number;
  models: DiscoveredModel[];
}

export interface CachedDiscovery {
  models: DiscoveredModel[];
  fresh: boolean;
  priceMultiplier?: number;
}

export interface DiscoveryCache {
  // Undefined when nothing usable is cached for this relay's endpoint and API.
  get(relay: RelayConfig, now?: number): CachedDiscovery | undefined;
  // priceMultiplier is omitted to keep the previous rate. Pass a number, including
  // 1 when billing is absent, to record the rate that matches this model list.
  store(relay: RelayConfig, models: DiscoveredModel[], priceMultiplier?: number): Promise<void>;
  // Records a rate on the matching entry without changing its model list or time.
  setPriceMultiplier(relay: RelayConfig, priceMultiplier: number): Promise<void>;
}

function isErrno(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isProviderName(value: string) {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !hasControlCharacters(value)
  );
}

function isEndpoint(value: string) {
  return value.length > 0 && value.length <= 2048 && !hasControlCharacters(value);
}

function isSupportedApi(value: unknown): value is SupportedApi {
  return typeof value === "string" && (SUPPORTED_APIS as readonly string[]).includes(value);
}

function isThinkingLevel(value: string) {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

function isXaiEffort(value: string): value is XaiEffort {
  return (XAI_EFFORTS as readonly string[]).includes(value);
}

function parseThinkingLevels(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const selected = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !isThinkingLevel(entry) || selected.has(entry)) {
      return undefined;
    }
    selected.add(entry);
  }
  return THINKING_LEVELS.filter((level) => selected.has(level));
}

function parseTokenList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const tokens: number[] = [];
  for (const entry of value) {
    const parsed = toPositiveInteger(entry);
    if (parsed === undefined) return undefined;
    tokens.push(parsed);
  }
  return tokens;
}

function parseInput(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return undefined;
  const input: ("text" | "image")[] = [];
  for (const entry of value) {
    if ((entry !== "text" && entry !== "image") || input.includes(entry)) return undefined;
    input.push(entry);
  }
  return input;
}

function parseXaiReasoning(value: unknown): XaiRemoteReasoning | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const flag = record.supportsReasoningEffort;
  if (flag !== undefined && typeof flag !== "boolean") return undefined;
  let efforts: XaiEffort[] | undefined;
  if ("efforts" in record) {
    if (!Array.isArray(record.efforts)) return undefined;
    const selected = new Set<XaiEffort>();
    for (const entry of record.efforts) {
      if (typeof entry !== "string" || !isXaiEffort(entry) || selected.has(entry)) return undefined;
      selected.add(entry);
    }
    efforts = XAI_EFFORTS.filter((effort) => selected.has(effort));
  }
  return {
    ...(typeof flag === "boolean" ? { supportsReasoningEffort: flag } : {}),
    ...(efforts !== undefined ? { efforts } : {}),
  };
}

function parseModel(value: unknown): DiscoveredModel | undefined {
  const model = asRecord(value);
  if (!model || !isSafeModelId(model.id) || typeof model.name !== "string") return undefined;
  const name = sanitizeDisplayString(model.name);
  if (!name) return undefined;
  const parsed: DiscoveredModel = { id: model.id, name };

  if ("contextWindow" in model) {
    const contextWindow = toPositiveInteger(model.contextWindow);
    if (contextWindow === undefined) return undefined;
    parsed.contextWindow = contextWindow;
  }
  if ("maxTokens" in model) {
    const maxTokens = toPositiveInteger(model.maxTokens);
    if (maxTokens === undefined) return undefined;
    parsed.maxTokens = maxTokens;
  }
  if ("supportedThinkingLevels" in model) {
    const supportedThinkingLevels = parseThinkingLevels(model.supportedThinkingLevels);
    if (supportedThinkingLevels === undefined) return undefined;
    parsed.supportedThinkingLevels = supportedThinkingLevels;
  }
  if ("reasoning" in model) {
    if (typeof model.reasoning !== "boolean") return undefined;
    parsed.reasoning = model.reasoning;
  }
  if ("input" in model) {
    const input = parseInput(model.input);
    if (input === undefined) return undefined;
    parsed.input = input;
  }
  if ("remoteMaxTokens" in model) {
    const remoteMaxTokens = parseTokenList(model.remoteMaxTokens);
    if (remoteMaxTokens === undefined) return undefined;
    parsed.remoteMaxTokens = remoteMaxTokens;
  }
  if ("xaiReasoning" in model) {
    const xaiReasoning = parseXaiReasoning(model.xaiReasoning);
    if (xaiReasoning === undefined) return undefined;
    parsed.xaiReasoning = xaiReasoning;
  }
  return parsed;
}

function parseEntry(provider: string, value: unknown): StoredEntry | undefined {
  if (!isProviderName(provider)) return undefined;
  const entry = asRecord(value);
  if (!entry || typeof entry.baseUrl !== "string" || !isEndpoint(entry.baseUrl)) return undefined;
  if (typeof entry.xai !== "boolean" || !Array.isArray(entry.models)) return undefined;
  let api: SupportedApi | undefined;
  if (entry.api !== undefined) {
    if (!isSupportedApi(entry.api)) return undefined;
    api = entry.api;
  }
  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const raw of entry.models) {
    const model = parseModel(raw);
    if (!model || seen.has(model.id)) return undefined;
    seen.add(model.id);
    models.push(model);
  }
  const fetchedAt = parseFetchedAt(entry.fetchedAt);
  const priceMultiplier = parsePriceMultiplier(entry.priceMultiplier);
  return {
    baseUrl: entry.baseUrl,
    ...(api ? { api } : {}),
    xai: entry.xai,
    ...(fetchedAt !== undefined ? { fetchedAt } : {}),
    ...(priceMultiplier !== undefined ? { priceMultiplier } : {}),
    models,
  };
}

function parsePriceMultiplier(value: unknown) {
  if (typeof value !== "number") return undefined;
  return firstStrictNonNegativeNumber(value);
}

function parseFetchedAt(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseCache(value: unknown) {
  const root = asRecord(value);
  const providers = root ? asRecord(root.providers) : undefined;
  if (!root || root.version !== CACHE_VERSION || !providers) return new Map<string, StoredEntry>();
  const entries = new Map<string, StoredEntry>();
  for (const [provider, raw] of Object.entries(providers)) {
    const entry = parseEntry(provider, raw);
    if (entry) entries.set(provider, entry);
  }
  return entries;
}

function serializeModel(model: DiscoveredModel) {
  return {
    id: model.id,
    name: model.name,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportedThinkingLevels !== undefined
      ? { supportedThinkingLevels: model.supportedThinkingLevels }
      : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.input !== undefined ? { input: model.input } : {}),
    ...(model.remoteMaxTokens !== undefined ? { remoteMaxTokens: model.remoteMaxTokens } : {}),
    ...(model.xaiReasoning !== undefined ? { xaiReasoning: model.xaiReasoning } : {}),
  };
}

function serialize(entries: Map<string, StoredEntry>) {
  const providers: Record<string, unknown> = {};
  for (const [provider, entry] of entries) {
    providers[provider] = {
      baseUrl: entry.baseUrl,
      ...(entry.api ? { api: entry.api } : {}),
      xai: entry.xai,
      ...(entry.fetchedAt !== undefined ? { fetchedAt: entry.fetchedAt } : {}),
      ...(entry.priceMultiplier !== undefined ? { priceMultiplier: entry.priceMultiplier } : {}),
      models: entry.models.map(serializeModel),
    };
  }
  return { version: CACHE_VERSION, providers };
}

function sameIdentity(entry: StoredEntry, relay: RelayConfig) {
  return entry.baseUrl === relay.baseUrl && entry.xai === relay.xai && entry.api === relay.api;
}

async function readEntries(path: string) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_RESPONSE_BYTES) return new Map<string, StoredEntry>();
    return parseCache(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return new Map<string, StoredEntry>();
  }
}

async function writeCache(path: string, entries: Map<string, StoredEntry>) {
  let permissions = 0o600;
  try {
    permissions = (await stat(path)).mode & 0o777;
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", permissions);
    try {
      await file.writeFile(`${JSON.stringify(serialize(entries), null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await chmod(temporary, permissions);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function loadDiscoveryCache(agentDir: string): Promise<DiscoveryCache> {
  let directory = agentDir;
  try {
    directory = await realpath(agentDir);
  } catch {
    // Discovery still works when the agent directory cannot be canonicalized.
  }
  const path = join(directory, DISCOVERY_CACHE_FILENAME);
  const entries = await readEntries(path);
  let queue: Promise<unknown> = Promise.resolve();
  return {
    get(relay, now = Date.now()) {
      const entry = entries.get(relay.provider);
      if (!entry || !sameIdentity(entry, relay)) return undefined;
      const fresh = entry.fetchedAt !== undefined && now - entry.fetchedAt < DISCOVERY_CACHE_TTL_MS;
      return {
        models: structuredClone(entry.models),
        fresh,
        ...(entry.priceMultiplier !== undefined ? { priceMultiplier: entry.priceMultiplier } : {}),
      };
    },
    store(relay, models, priceMultiplier) {
      const save = queue.then(async () => {
        const current = entries.get(relay.provider);
        const keptMultiplier =
          priceMultiplier ??
          (current && sameIdentity(current, relay) ? current.priceMultiplier : undefined);
        const next = new Map(entries);
        next.set(relay.provider, {
          baseUrl: relay.baseUrl,
          ...(relay.api ? { api: relay.api } : {}),
          xai: relay.xai,
          fetchedAt: Date.now(),
          ...(keptMultiplier !== undefined ? { priceMultiplier: keptMultiplier } : {}),
          models: structuredClone(models),
        });
        await writeCache(path, next);
        entries.clear();
        for (const [provider, entry] of next) entries.set(provider, entry);
      });
      queue = save.catch(() => undefined);
      return save;
    },
    setPriceMultiplier(relay, priceMultiplier) {
      const save = queue.then(async () => {
        const current = entries.get(relay.provider);
        if (!current || !sameIdentity(current, relay)) return;
        const next = new Map(entries);
        next.set(relay.provider, { ...current, priceMultiplier });
        await writeCache(path, next);
        entries.clear();
        for (const [provider, entry] of next) entries.set(provider, entry);
      });
      queue = save.catch(() => undefined);
      return save;
    },
  };
}
