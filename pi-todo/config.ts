import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

interface TodoConfig {
  guidance?: GuidanceFields;
  maxWidgetLines?: number;
  /**
   * Key spec for the overlay collapse/expand shortcut, in the same format as
   * pi-coding-agent keybinding ids (`modifier+key`, e.g. `ctrl+shift+t`, `alt+o`).
   * Defaults to `"ctrl+shift+t"`. Pass `"off"` to disable the collapse shortcut.
   */
  collapseKey?: string;
}

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
  description?: string;
}

/** Default content-row budget when the config is missing or invalid. */
export const DEFAULT_MAX_WIDGET_LINES = 12;

/** Key spec for the collapse/expand shortcut. */
export type CollapseKeySpec = string;

/** Default collapse/expand key when the config value is missing or invalid. */
export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+shift+t";

/** Sentinel value for `collapseKey` that disables the shortcut. */
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function resolveConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (!xdg) return join(homedir(), ".config");
  const expanded = expandTilde(xdg);
  return isAbsolute(expanded) ? expanded : join(homedir(), ".config");
}

function configPath(name: string): string {
  return join(resolveConfigDir(), name, "config.json");
}

function legacyConfigPath(name: string): string {
  return join(homedir(), ".config", name, "config.json");
}

function loadJsonConfig<T>(path: string): T {
  if (!existsSync(path)) return {} as T;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
    return parsed as T;
  } catch (error) {
    console.warn(`[pi-todo] invalid JSON at ${path}; using defaults: ${String(error)}`);
    return {} as T;
  }
}

export function loadConfig(): TodoConfig {
  const currentPath = configPath("rpiv-todo");
  if (existsSync(currentPath)) return loadJsonConfig<TodoConfig>(currentPath);
  return loadJsonConfig<TodoConfig>(legacyConfigPath("rpiv-todo"));
}

export function getMaxWidgetLines(): number {
  const lines = loadConfig().maxWidgetLines;
  return typeof lines === "number" && lines >= 3 ? lines : DEFAULT_MAX_WIDGET_LINES;
}

const SPECIAL_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

/** Validate a collapse-key spec against pi-tui's KeyId grammar. */
export function isValidCollapseKeySpec(spec: string): boolean {
  if (!spec || spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
  const parts = spec.split("+");
  const base = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (modifiers.length !== new Set(modifiers).size) return false;
  if (!modifiers.every((modifier) => MODIFIERS.has(modifier))) return false;
  return base.length === 1
    ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base)
    : SPECIAL_KEYS.has(base);
}

/** Resolve the configured collapse key, falling back to the default. */
export function resolveCollapseKey(): CollapseKeySpec {
  const configured = loadConfig().collapseKey;
  const raw = typeof configured === "string" ? configured.trim().toLowerCase() : undefined;
  if (!raw) return DEFAULT_COLLAPSE_KEY;
  if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
  return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

export function validateGuidanceFields(fields: unknown): GuidanceFields {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const value = fields as Record<string, unknown>;
  const result: GuidanceFields = {};
  if (typeof value.promptSnippet === "string" && value.promptSnippet.length > 0) {
    result.promptSnippet = value.promptSnippet;
  }
  if (
    Array.isArray(value.promptGuidelines) &&
    value.promptGuidelines.length > 0 &&
    value.promptGuidelines.every((item) => typeof item === "string" && item.length > 0)
  ) {
    result.promptGuidelines = value.promptGuidelines;
  }
  if (typeof value.description === "string" && value.description.length > 0)
    result.description = value.description;
  return result;
}
