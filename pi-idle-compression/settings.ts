import { readFile } from "node:fs/promises";

export type Settings = Record<string, unknown>;

export const SETTINGS_KEY = "piIdleCompression";
export const DEFAULT_IDLE_MINUTES = 50;
/** setTimeout clamps delays above 2^31 - 1 ms to 1 ms; keep every idle time below it. */
export const MAX_IDLE_MINUTES = Math.floor((2 ** 31 - 1) / 60_000);

export interface IdleSettings {
  readonly enabled: boolean;
  readonly idleMinutes: number;
}

function object(value: unknown, label: string): Settings {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Settings;
}

function enabledValue(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label}.enabled must be true or false`);
  return value;
}

function minutesValue(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_IDLE_MINUTES
  ) {
    throw new Error(
      `${label}.idleMinutes must be a number of minutes greater than 0 and at most ${MAX_IDLE_MINUTES}`,
    );
  }
  return value;
}

/** Resolve each field from the model entry, then the provider entry, then the
 * top level, then the defaults. Every layer present is validated, even when a
 * more specific one wins, so a typo never hides until the model changes. */
export function resolveIdleSettings(
  settings: Settings,
  provider: string,
  modelId: string,
): IdleSettings {
  const top = object(settings[SETTINGS_KEY], SETTINGS_KEY);
  const providers = object(top.providers, `${SETTINGS_KEY}.providers`);
  const models = object(top.models, `${SETTINGS_KEY}.models`);
  const modelKey = `${provider}/${modelId}`;
  const layers = [
    [
      object(models[modelKey], `${SETTINGS_KEY}.models["${modelKey}"]`),
      `${SETTINGS_KEY}.models["${modelKey}"]`,
    ],
    [
      object(providers[provider], `${SETTINGS_KEY}.providers["${provider}"]`),
      `${SETTINGS_KEY}.providers["${provider}"]`,
    ],
    [top, SETTINGS_KEY],
  ] as const;
  const enabled = layers.map(([layer, label]) => enabledValue(layer.enabled, label));
  const minutes = layers.map(([layer, label]) => minutesValue(layer.idleMinutes, label));
  return {
    enabled: enabled.find((value) => value !== undefined) ?? true,
    idleMinutes: minutes.find((value) => value !== undefined) ?? DEFAULT_IDLE_MINUTES,
  };
}

export async function readSettings(path: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return object(JSON.parse(text), path);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
