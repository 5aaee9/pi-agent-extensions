import { chmod, mkdir, open, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type Settings = Record<string, unknown>;

export const AUTOCOMPACT_USAGE =
  "Usage: /autocompact [300k | 1m | 300000 | 80% | off | default] [--save | --save-provider | --save-global]";

/** A threshold or cap: an absolute token count or a share of the model's context window. */
export type LimitValue =
  | { readonly kind: "tokens"; readonly tokens: number }
  | { readonly kind: "percent"; readonly percent: number };

export type SaveTarget = "model" | "provider" | "global";

export type AutocompactCommand =
  | { readonly kind: "status" }
  | { readonly kind: "off" }
  | { readonly kind: "default" }
  | { readonly kind: "limit"; readonly value: LimitValue; readonly save: SaveTarget | null };

/** User plugin defaults: thresholds per `provider/modelId`, caps per provider and globally. */
export interface PluginDefaults {
  readonly models: Map<string, LimitValue>;
  readonly providers: Map<string, LimitValue>;
  global: LimitValue | undefined;
}

export type LimitSource = "session" | "model" | "provider" | "global" | "window";

export interface EffectiveLimit {
  readonly tokens: number;
  readonly source: LimitSource;
}

export interface LimitLevels {
  /** undefined: no session override; null: `/autocompact off`. */
  readonly session: LimitValue | null | undefined;
  readonly model: LimitValue | undefined;
  readonly provider: LimitValue | undefined;
  readonly global: LimitValue | undefined;
}

export type SaveDestination =
  | { readonly target: "model"; readonly key: string }
  | { readonly target: "provider"; readonly provider: string }
  | { readonly target: "global" };

const SAVE_FLAGS: Record<string, SaveTarget> = {
  "--save": "model",
  "--save-provider": "provider",
  "--save-global": "global",
};

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

/** `80%`, `12.5%`: greater than 0 and at most 100. */
function parsePercent(input: string): LimitValue | undefined {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(input);
  if (!match) return undefined;
  const percent = Number(match[1]);
  if (!(percent > 0 && percent <= 100)) {
    throw new Error("Percentage must be greater than 0% and at most 100%");
  }
  return { kind: "percent", percent };
}

/** Command form: `300k`, `0.3m`, `300000`, or `80%`. */
export function parseLimit(input: string): LimitValue {
  const text = input.trim();
  const percent = parsePercent(text);
  if (percent) return percent;
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text);
  if (!match) throw new Error(AUTOCOMPACT_USAGE);
  const tokens = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
  if (!Number.isSafeInteger(tokens) || tokens <= 0) {
    throw new Error("Threshold must be a positive safe integer number of tokens");
  }
  return { kind: "tokens", tokens };
}

/** Settings form: a positive integer token count or a `"<n>%"` string. */
export function limitFromSettings(value: unknown, label: string): LimitValue {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return { kind: "tokens", tokens: value };
  }
  if (typeof value === "string") {
    try {
      const percent = parsePercent(value);
      if (percent) return percent;
    } catch {
      // Reported below with the setting's name.
    }
  }
  throw new Error(
    `Invalid ${label}: expected a positive integer token count or a percentage such as "80%"`,
  );
}

export function limitToSettings(value: LimitValue): number | string {
  return value.kind === "tokens" ? value.tokens : `${value.percent}%`;
}

export function describeLimit(value: LimitValue): string {
  return value.kind === "tokens"
    ? `${value.tokens.toLocaleString("en-US")} tokens`
    : `${value.percent}% of the context window`;
}

export function resolveLimit(value: LimitValue, contextWindow: number): number {
  return value.kind === "tokens" ? value.tokens : Math.floor((contextWindow * value.percent) / 100);
}

/** The lowest of the threshold (session override, else model limit), the provider
 * and global caps, and the context window. Ties keep the more specific level. */
export function effectiveLimit(
  levels: LimitLevels,
  contextWindow: number,
): EffectiveLimit | undefined {
  if (levels.session === null) return undefined;
  const candidates: [LimitSource, LimitValue | undefined][] = [
    levels.session === undefined ? ["model", levels.model] : ["session", levels.session],
    ["provider", levels.provider],
    ["global", levels.global],
  ];
  let best: EffectiveLimit | undefined;
  for (const [source, value] of candidates) {
    if (value === undefined) continue;
    const tokens = resolveLimit(value, contextWindow);
    if (best === undefined || tokens < best.tokens) best = { tokens, source };
  }
  if (best === undefined) return undefined;
  return contextWindow < best.tokens ? { tokens: contextWindow, source: "window" } : best;
}

/** Why an effective threshold cannot drive plugin compaction, or undefined when it can. */
export function unusableReason(
  tokens: number,
  contextWindow: number,
  keepRecentTokens: number,
): string | undefined {
  if (tokens <= keepRecentTokens) {
    return `${tokens.toLocaleString("en-US")} tokens does not exceed keepRecentTokens (${keepRecentTokens.toLocaleString("en-US")})`;
  }
  if (tokens >= contextWindow) {
    return `${tokens.toLocaleString("en-US")} tokens is not below the context window (${contextWindow.toLocaleString("en-US")})`;
  }
  return undefined;
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

export function emptyDefaults(): PluginDefaults {
  return { models: new Map(), providers: new Map(), global: undefined };
}

/** Optional user defaults: `modelLimits`, `providerLimits`, and `globalLimit`. */
export function defaultLimits(settings: Settings): PluginDefaults {
  const config = object(settings.piAutocompact, "piAutocompact");
  const entries = (field: string, valid: (key: string) => boolean) =>
    new Map(
      Object.entries(object(config[field], `piAutocompact.${field}`)).map(([key, value]) => {
        if (!valid(key)) throw new Error(`Invalid piAutocompact.${field} entry: ${key}`);
        return [key, limitFromSettings(value, `piAutocompact.${field} entry ${key}`)];
      }),
    );
  return {
    models: entries("modelLimits", (key) => key.includes("/")),
    providers: entries("providerLimits", (key) => key.length > 0 && !key.includes("/")),
    global:
      config.globalLimit === undefined
        ? undefined
        : limitFromSettings(config.globalLimit, "piAutocompact.globalLimit"),
  };
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

  let flag: string | undefined;
  const words: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower in SAVE_FLAGS) {
      if (flag === lower) throw new Error(`${flag} may be given once. ${AUTOCOMPACT_USAGE}`);
      if (flag !== undefined) {
        throw new Error(
          `Only one of --save, --save-provider, --save-global may be given. ${AUTOCOMPACT_USAGE}`,
        );
      }
      flag = lower;
      continue;
    }
    if (token.startsWith("-")) throw new Error(`Unknown option: ${token}. ${AUTOCOMPACT_USAGE}`);
    words.push(token);
  }

  const missing = () =>
    new Error(`${flag} requires a threshold, for example /autocompact 300k ${flag}`);
  if (words.length !== 1) throw flag ? missing() : new Error(AUTOCOMPACT_USAGE);
  const word = words[0].toLowerCase();
  if (word === "off" || word === "default") {
    if (flag) throw missing();
    return { kind: word };
  }
  return { kind: "limit", value: parseLimit(word), save: flag ? SAVE_FLAGS[flag] : null };
}

/** Merge one limit into settings without mutating the input. */
export function withLimit(
  settings: Settings,
  destination: SaveDestination,
  value: LimitValue,
): Settings {
  const stored = limitToSettings(value);
  limitFromSettings(stored, "limit");
  const config = object(settings.piAutocompact, "piAutocompact");
  const merge = (field: string, key: string): Settings => ({
    ...config,
    [field]: { ...object(config[field], `piAutocompact.${field}`), [key]: stored },
  });
  let next: Settings;
  if (destination.target === "model") {
    if (!destination.key.includes("/")) throw new Error(`Invalid model key: ${destination.key}`);
    next = merge("modelLimits", destination.key);
  } else if (destination.target === "provider") {
    if (!destination.provider || destination.provider.includes("/")) {
      throw new Error(`Invalid provider: ${destination.provider}`);
    }
    next = merge("providerLimits", destination.provider);
  } else {
    next = { ...config, globalLimit: stored };
  }
  return { ...settings, piAutocompact: next };
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

async function writeLimit(
  path: string,
  destination: SaveDestination,
  value: LimitValue,
): Promise<void> {
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
    const next = withLimit(await readSettings(target), destination, value);
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

/** Merge one limit into the user settings file. Saves run one at a time. */
export function saveLimit(
  path: string,
  destination: SaveDestination,
  value: LimitValue,
): Promise<void> {
  const save = saveQueue.then(() => writeLimit(path, destination, value));
  saveQueue = save.catch(() => undefined);
  return save;
}

export function supportsBoundaries(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 0 || minor > 87 || (minor === 87 && patch >= 1);
}
