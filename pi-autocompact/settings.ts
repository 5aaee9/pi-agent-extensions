import { chmod, mkdir, open, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type Settings = Record<string, unknown>;

export const AUTOCOMPACT_USAGE =
  "Usage: /autocompact [300k | 1m | 300000 | off | default] [--save]";

export type AutocompactCommand =
  | { readonly kind: "status" }
  | { readonly kind: "off" }
  | { readonly kind: "default" }
  | { readonly kind: "limit"; readonly tokens: number; readonly save: boolean };

const LOCK_STALE_MS = 10_000;
const LOCK_ATTEMPTS = 25;
const LOCK_DELAY_MS = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

export function object(value: unknown, label: string): Settings {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Settings;
}

export function parseLimit(input: string): number {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(input.trim());
  if (!match) throw new Error(AUTOCOMPACT_USAGE);
  const limit = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Threshold must be a positive safe integer number of tokens");
  }
  return limit;
}

function tokenValue(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function effectiveCompaction(global: Settings, project: Settings, modelKey: string) {
  const g = object(global.compaction, "compaction");
  const p = object(project.compaction, "project compaction");
  const gm = object(object(g.modelOverrides, "modelOverrides")[modelKey], "model override");
  const pm = object(object(p.modelOverrides, "modelOverrides")[modelKey], "project model override");
  const resolve = (field: string, fallback: number) => {
    const values = [pm[field], gm[field], p[field], g[field]].map((v) => tokenValue(v, field));
    return values.find((v) => v !== undefined) ?? fallback;
  };
  return {
    enabled: (p.enabled ?? g.enabled ?? true) !== false,
    reserveTokens: resolve("reserveTokens", 16384),
    keepRecentTokens: resolve("keepRecentTokens", 20000),
  };
}

export function validateLimit(
  limit: number,
  contextWindow: number,
  keepRecentTokens: number,
): void {
  if (!Number.isSafeInteger(limit) || limit <= keepRecentTokens) {
    throw new Error(
      `Threshold must be an integer greater than keepRecentTokens (${keepRecentTokens})`,
    );
  }
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 || limit >= contextWindow) {
    throw new Error(`Threshold must be less than the model context window (${contextWindow})`);
  }
}

/** Optional user defaults. `/autocompact <threshold> --save` writes one entry. */
export function defaultLimits(settings: Settings): Map<string, number> {
  const config = object(settings.piAutocompact, "piAutocompact");
  const models = object(config.modelLimits, "piAutocompact.modelLimits");
  return new Map(
    Object.entries(models).map(([key, value]) => {
      if (
        !key.includes("/") ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new Error(`Invalid piAutocompact.modelLimits entry: ${key}`);
      }
      return [key, value];
    }),
  );
}

export async function readSettings(path: string): Promise<Settings> {
  try {
    return object(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function parseAutocompactCommand(input: string): AutocompactCommand {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return { kind: "status" };

  let save = false;
  const words: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase() === "--save") {
      if (save) throw new Error(`--save may be given once. ${AUTOCOMPACT_USAGE}`);
      save = true;
      continue;
    }
    if (token.startsWith("-")) throw new Error(`Unknown option: ${token}. ${AUTOCOMPACT_USAGE}`);
    words.push(token);
  }

  if (words.length !== 1) {
    throw new Error(
      save
        ? "--save requires a threshold, for example /autocompact 300k --save"
        : AUTOCOMPACT_USAGE,
    );
  }
  const word = words[0].toLowerCase();
  if (word === "off" || word === "default") {
    if (save) {
      throw new Error("--save requires a threshold, for example /autocompact 300k --save");
    }
    return { kind: word };
  }
  return { kind: "limit", tokens: parseLimit(word), save };
}

export function withModelLimit(settings: Settings, modelKey: string, limit: number): Settings {
  if (!modelKey.includes("/")) throw new Error(`Invalid model key: ${modelKey}`);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Threshold must be a positive safe integer number of tokens");
  }
  const config = object(settings.piAutocompact, "piAutocompact");
  const models = object(config.modelLimits, "piAutocompact.modelLimits");
  return {
    ...settings,
    piAutocompact: {
      ...config,
      modelLimits: {
        ...models,
        [modelKey]: limit,
      },
    },
  };
}

// Same directory lock Pi's settings manager takes via proper-lockfile: an empty
// `<settings.json>.lock` directory. Holding it across the read-merge-rename keeps
// a concurrent Pi save from dropping `piAutocompact` or this write from dropping
// keys Pi added after our last read.
async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs < LOCK_STALE_MS) return false;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
  try {
    await rmdir(lockPath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return true;
}

async function acquireSettingsLock(lockPath: string): Promise<void> {
  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt++) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    if (await removeStaleLock(lockPath)) {
      try {
        await mkdir(lockPath);
        return;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    if (attempt === LOCK_ATTEMPTS) break;
    await delay(LOCK_DELAY_MS);
  }
  throw new Error("Could not save autocompact settings because the settings file is locked");
}

async function writeModelLimit(path: string, modelKey: string, limit: number): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const lockPath = `${target}.lock`;
  await acquireSettingsLock(lockPath);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    let mode: number | undefined;
    try {
      mode = (await stat(target)).mode & 0o777;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const next = withModelLimit(await readSettings(target), modelKey, limit);
    const file = await open(temporary, "wx", mode ?? 0o666);
    try {
      await file.writeFile(JSON.stringify(next, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    await rmdir(lockPath).catch(() => undefined);
  }
}

let saveQueue: Promise<unknown> = Promise.resolve();

/** Merge one model limit into the user settings file. Saves run one at a time. */
export function saveModelLimit(path: string, modelKey: string, limit: number): Promise<void> {
  const save = saveQueue.then(() => writeModelLimit(path, modelKey, limit));
  saveQueue = save.catch(() => undefined);
  return save;
}

export function supportsBoundaries(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 0 || minor > 87 || (minor === 87 && patch >= 1);
}
