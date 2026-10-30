/** Verify the installed tarball offline with the repo dev tooling, no host peers, and no API calls. */
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import * as jsxRuntime from "react/jsx-runtime";
import * as React from "react";

const PACKAGE_ID = "@indexyz/dsh-prompt-suggestions";
const NAMESPACE = "prompt-suggestions";
const OVERLAY_SLOT = "conversation.input.overlay";
const SETTINGS_SLOT = "settings.general.item";
const INJECT = ["connection", "locale", "slots", "remote.settings"];

type UnknownFunction = (...args: unknown[]) => unknown;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be an object`,
  );
  return value as Record<string, unknown>;
}

function callable(value: unknown, description: string): UnknownFunction {
  assert.equal(typeof value, "function", `${description} must be a function`);
  return value as UnknownFunction;
}

function insidePackage(dir: string, path: string, field: string): void {
  const fromPackage = relative(dir, path);
  assert.ok(
    fromPackage !== "" &&
      fromPackage !== ".." &&
      !fromPackage.startsWith(`..${sep}`) &&
      !isAbsolute(fromPackage),
    `${field} must point to a file inside the installed package`,
  );
}

function packagedPath(dir: string, value: unknown, field: string): string {
  assert.ok(
    typeof value === "string" && value.trim() !== "" && !isAbsolute(value),
    `${field} must declare a package-relative file path`,
  );
  const path = resolve(dir, value);
  insidePackage(dir, path, field);
  assert.ok(statSync(path).isFile(), `${field} must point to a file: ${value}`);
  insidePackage(dir, realpathSync(path), field);
  return path;
}

function exportTargets(value: unknown, field = "exports"): string[] {
  if (typeof value === "string") return [value];
  if (value === null) return [];
  assert.ok(typeof value === "object" && value !== undefined, `${field} is invalid`);
  return Object.entries(value).flatMap(([key, nested]: [string, unknown]) =>
    exportTargets(nested, `${field}.${key}`),
  );
}

interface ModuleRegistration {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => unknown;
}

interface ClientPlugin {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

interface RegisteredRow {
  readonly options: Record<string, unknown>;
  readonly render: UnknownFunction;
}

/**
 * Execute the installed browser artifact the way the page's module loader does:
 * a real jsdom window, the real module-loader registration, and the real React
 * modules the page supplies. The primitives module is present as an empty
 * module because the pinned primitives package cannot be evaluated standalone
 * (its shipped lib imports runtime modules the workspace does not install);
 * this smoke only inspects registration and disposal, never renders the row.
 * @param clientPath - the installed `client.js`.
 */
async function checkClient(clientPath: string): Promise<void> {
  const registrations: ModuleRegistration[] = [];
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(dom.window, {
    __ModuleLoader__: {
      load(registration: ModuleRegistration): void {
        registrations.push(registration);
      },
    },
  });
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  // A real module evaluation of the installed artifact, not a shim: the file is
  // ESM-valid and calls the loader contract captured above.
  await import(pathToFileURL(clientPath).href);
  assert.equal(registrations.length, 1, "client.js must register exactly one module");
  const registration = registrations[0];
  assert.ok(registration !== undefined, "client module registration is missing");
  assert.equal(registration.id, PACKAGE_ID, "client module id");

  const factory = callable(registration.factory, "client module factory");
  const plugin = object(
    factory((id: unknown): unknown => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "@deepseek-ai/dsh-client-ui-primitives") return {};
      throw new Error(`client requested a module outside the page module table: ${String(id)}`);
    }),
    "client factory result",
  ) as unknown as ClientPlugin;
  assert.deepEqual(Array.from(plugin.inject), INJECT, "client injected services");
  const apply = callable(plugin.apply, "client apply export");

  const dictionaries = new Map<string, Record<string, unknown>>();
  const injectedSlots: string[] = [];
  const rows: RegisteredRow[] = [];
  const cleanups: UnknownFunction[] = [];
  const services = new Map<string, unknown>([
    ["connection", { rpc: { call: () => Promise.reject(new Error("no remote calls")) } }],
    ["remote.settings", { describe: () => Promise.reject(new Error("no remote calls")) }],
    ["shortcuts", { catalog: { getSnapshot: () => [] }, fixedCatalog: { getSnapshot: () => [] } }],
  ]);
  const context = {
    get(service: string): unknown {
      assert.ok(services.has(service), `unexpected service requested: ${service}`);
      return services.get(service);
    },
    effect(effect: unknown): void {
      const cleanup = callable(effect, "client effect")();
      if (cleanup !== undefined) cleanups.push(callable(cleanup, "effect cleanup"));
    },
    locale: {
      register(namespace: string, dictionary: unknown): () => void {
        assert.equal(namespace, NAMESPACE, "locale namespace");
        assert.ok(!dictionaries.has(namespace), "locale registered more than once");
        dictionaries.set(namespace, object(dictionary, "locale dictionary"));
        return () => {
          dictionaries.delete(namespace);
        };
      },
      bind(namespace: string): (key: string) => unknown {
        assert.equal(namespace, NAMESPACE, "bound locale namespace");
        return (key: string): unknown => {
          const dictionary = object(dictionaries.get(namespace), "registered locale dictionary");
          return object(dictionary["en"], "English locale")[key];
        };
      },
    },
    slots: {
      inject(name: string, callback: unknown): unknown {
        injectedSlots.push(name);
        return callable(callback, "slot injection callback")();
      },
      register(options: unknown, render: unknown): () => void {
        const row = {
          options: object(options, "slot registration options"),
          render: callable(render, "slot renderer"),
        };
        rows.push(row);
        return () => {
          rows.splice(rows.indexOf(row), 1);
        };
      },
    },
  };
  apply(context);
  assert.deepEqual(
    injectedSlots,
    [OVERLAY_SLOT, SETTINGS_SLOT],
    "composer and General settings slot injections",
  );
  assert.equal(rows.length, 2, "client must register the overlay and one General settings row");
  const [overlay, settings] = rows;
  assert.ok(overlay, "composer overlay registration is missing");
  assert.ok(settings, "General settings registration is missing");
  assert.equal(overlay.options["name"], OVERLAY_SLOT, "overlay slot");
  assert.equal(overlay.options["id"], NAMESPACE, "overlay id");
  assert.equal(overlay.options["order"], 50, "overlay order");
  assert.ok(React.isValidElement(overlay.render({})), "overlay renderer must return an element");
  assert.equal(settings.options["name"], SETTINGS_SLOT, "settings row slot");
  assert.equal(settings.options["id"], NAMESPACE, "settings row id");
  assert.equal(settings.options["order"], 45, "settings row order");
  assert.equal(
    callable(settings.options["label"], "settings row label")(),
    "Next-message suggestions",
  );
  assert.ok(
    React.isValidElement(settings.render()),
    "settings row renderer must return an element",
  );
  const dictionary = object(dictionaries.get(NAMESPACE), "registered locale dictionary");
  assert.equal(object(dictionary["zh"], "Chinese locale")["label"], "下一句建议");
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(rows.length, 0, "slot registrations must unregister on disposal");
  assert.equal(dictionaries.size, 0, "locale must unregister on disposal");
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  assert.ok(
    process.argv.length === 3 && argument !== undefined && argument.trim() !== "",
    "usage: node test/smoke-release.ts <installed-package-dir>",
  );
  const installed = realpathSync(resolve(argument));
  assert.ok(statSync(installed).isDirectory(), "installed package path must be a directory");
  const parsed: unknown = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const manifest = object(parsed, "package.json");
  assert.equal(manifest["name"], PACKAGE_ID, "installed package name");
  packagedPath(installed, manifest["main"], "main");
  packagedPath(installed, manifest["types"], "types");
  const targets = exportTargets(manifest["exports"]);
  assert.ok(targets.length > 0, "package.json must declare exports targets");
  for (const target of targets) packagedPath(installed, target, "exports");
  const dsh = object(manifest["dsh"], "dsh manifest");
  const bundle = object(dsh["bundle"], "dsh.bundle manifest");
  packagedPath(installed, bundle["patch"], "dsh.bundle.patch");
  packagedPath(installed, "lib/index.js", "built host entry");
  const patch = readFileSync(packagedPath(installed, bundle["patch"], "dsh.bundle.patch"), "utf8");
  assert.match(patch, /id:\s*prompt-suggestions/u, "bundle patch must insert the plugin row");
  await checkClient(packagedPath(installed, "client.js", "built client entry"));
  console.log(
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch, client module/inject/apply, overlay/settings/locale/disposal)`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
