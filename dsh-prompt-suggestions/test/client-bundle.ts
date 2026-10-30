/**
 * Real browser-plane loader shared by the client tests.
 *
 * Executes the generated `client.js` through the same single module-loader
 * registration the page performs, with real React and the real JSX runtime.
 *
 * The pinned `@deepseek-ai/dsh-client-ui-primitives` package cannot be
 * evaluated standalone in this workspace: its shipped lib imports runtime
 * modules the package neither declares nor ships (clsx, react-dom, shiki,
 * katex, mdast, ...), and the web shell normally supplies those through its
 * bundled module table. The loader below therefore exposes an empty primitives
 * module; no test in this package renders the settings switch, so that module is
 * never read. Rendering it needs the missing dependencies and is reported as
 * blocked, not replaced with a stub component.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as jsxRuntime from "react/jsx-runtime";
import * as React from "react";
import { onTestFinished } from "vitest";

import type { ConnectionFace, SettingsFace, ShortcutsFace } from "../src/client/contracts.ts";

/** The plugin object the page's module loader receives. */
export interface ClientPlugin {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

/** One slot registration as the real `apply` makes it. */
export interface RegisteredRow {
  readonly slot: string;
  readonly options: Record<string, unknown>;
  render(props: Record<string, unknown>): unknown;
}

/** The page services the plugin reads, as the shell exposes them. */
export interface PageServices {
  readonly connection?: ConnectionFace;
  readonly settings?: SettingsFace;
  readonly shortcuts?: ShortcutsFace;
}

/** A mounted client module: registrations, disposal, and locale dictionaries. */
export interface ClientMount {
  readonly rows: RegisteredRow[];
  readonly dictionaries: Map<string, Record<string, Record<string, string>>>;
  dispose(): Promise<void>;
}

interface ModuleRegistration {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => unknown;
}

let loadCount = 0;

/**
 * Execute the generated browser artifact and return its plugin export.
 * @returns the real client plugin registered by `client.js`.
 */
export async function loadClientPlugin(): Promise<ClientPlugin> {
  const registrations: ModuleRegistration[] = [];
  const view = globalThis as { window?: Window };
  if (view.window === undefined) throw new Error("client tests need a jsdom window");
  Object.assign(view.window, {
    __ModuleLoader__: {
      load(registration: ModuleRegistration): void {
        registrations.push(registration);
      },
    },
  });
  // client.js sits one level above this file; it is the generated artifact this
  // module-loader contract executes.
  const code = await readFile(resolve(import.meta.dirname, "../client.js"), "utf8");
  loadCount += 1;
  await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${loadCount}`
  );
  const registration = registrations[0];
  if (registration === undefined) throw new Error("client.js did not register a module");
  if (registrations.length !== 1) throw new Error("client.js must register exactly one module");
  if (registration.id !== "@indexyz/dsh-prompt-suggestions") {
    throw new Error(`unexpected client module id: ${registration.id}`);
  }
  const plugin = registration.factory((id) => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "@deepseek-ai/dsh-client-ui-primitives") return {};
    throw new Error(`unexpected module request: ${id}`);
  });
  if (plugin === null || typeof plugin !== "object")
    throw new Error("client plugin is not an object");
  const candidate = plugin as { inject?: unknown; apply?: unknown };
  if (!Array.isArray(candidate.inject) || typeof candidate.apply !== "function") {
    throw new Error("client plugin must expose inject and apply");
  }
  return plugin as ClientPlugin;
}

/**
 * Mount the real client plugin on a real Cordis context with the page's
 * services provided, exactly as the web shell composes it.
 * @param plugin - the loaded client plugin.
 * @param services - the page services the plugin reads.
 * @returns the real registrations and their disposal.
 */
export async function mountClient(
  plugin: ClientPlugin,
  services: PageServices = {},
): Promise<ClientMount> {
  const rows: RegisteredRow[] = [];
  const dictionaries = new Map<string, Record<string, Record<string, string>>>();
  const locale = {
    register(namespace: string, dictionary: Record<string, Record<string, string>>) {
      dictionaries.set(namespace, dictionary);
      return () => {
        dictionaries.delete(namespace);
      };
    },
    bind(namespace: string) {
      return (key: string): string => {
        const dictionary = dictionaries.get(namespace);
        if (dictionary === undefined) throw new Error("locale not registered");
        return dictionary["en"]?.[key] ?? key;
      };
    },
  };
  const slots = {
    inject(_name: string, callback: () => unknown) {
      return callback();
    },
    register(options: unknown, render: unknown) {
      const row: RegisteredRow = {
        slot: String((options as { name?: unknown }).name),
        options: options as Record<string, unknown>,
        render: render as RegisteredRow["render"],
      };
      rows.push(row);
      return () => {
        const index = rows.indexOf(row);
        if (index !== -1) rows.splice(index, 1);
      };
    },
  };
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  ctx.provide("locale", locale);
  ctx.provide("slots", slots);
  if (services.connection !== undefined) ctx.provide("connection", services.connection);
  if (services.settings !== undefined) ctx.provide("remote.settings", services.settings);
  if (services.shortcuts !== undefined) ctx.provide("shortcuts", services.shortcuts);
  await ctx.plugin({ apply: plugin.apply, inject: [...plugin.inject] }).await();

  return { rows, dictionaries, dispose: () => ctx.fiber.dispose() };
}

/** Find the overlay slot registration the real plugin made. */
export function overlayRow(mount: ClientMount): RegisteredRow {
  const row = mount.rows.find((item) => item.slot === "conversation.input.overlay");
  if (row === undefined) throw new Error("overlay slot not registered");
  return row;
}

/** Find the General settings slot registration the real plugin made. */
export function settingsRow(mount: ClientMount): RegisteredRow {
  const row = mount.rows.find((item) => item.slot === "settings.general.item");
  if (row === undefined) throw new Error("settings slot not registered");
  return row;
}
