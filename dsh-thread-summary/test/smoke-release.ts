/** Verify the installed tarball with Node built-ins and no host peers or API calls. */
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";

const PACKAGE_ID = "@indexyz/dsh-thread-summary";
const SETTINGS_SLOT = "settings.general.item";
const NAMESPACE = "thread-summary";
const INJECT = ["slots", "locale", "remote.settings", "remote.session"];

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

function checkClient(clientPath: string): void {
  const registrations: unknown[] = [];
  // A separate browser-like context prevents accidental Node imports or access
  // to real host services while executing the installed artifact.
  runInNewContext(
    readFileSync(clientPath, "utf8"),
    {
      window: {
        __ModuleLoader__: {
          load(registration: unknown): void {
            registrations.push(registration);
          },
        },
      },
    },
    { filename: clientPath, timeout: 5_000 },
  );
  assert.equal(registrations.length, 1, "client.js must register exactly one module");
  const registration = object(registrations[0], "client module registration");
  assert.equal(registration["id"], PACKAGE_ID, "client module id");

  class ComponentStub {}
  const element = (type: unknown, props: unknown): unknown => ({ type, props });
  const fragment = Symbol("Fragment");
  const modules = new Map<string, unknown>([
    ["react", { Component: ComponentStub, createElement: element, Fragment: fragment }],
    ["react/jsx-runtime", { jsx: element, jsxs: element, Fragment: fragment }],
    ["@deepseek-ai/dsh-client-ui-primitives", { Button: element, Switch: element, Menu: element }],
  ]);
  const factory = callable(registration["factory"], "client module factory");
  const plugin = object(
    factory((id: unknown): unknown => {
      assert.ok(
        typeof id === "string" && modules.has(id),
        `client requested a module outside the page module table: ${String(id)}`,
      );
      return modules.get(id);
    }),
    "client factory result",
  );
  const inject: unknown = plugin["inject"];
  assert.ok(Array.isArray(inject), "client must export an inject service list");
  assert.deepEqual(Array.from(inject), INJECT, "client injected services");
  const apply = callable(plugin["apply"], "client apply export");

  const dictionaries = new Map<string, Record<string, unknown>>();
  const injectedSlots: string[] = [];
  const rows: { options: Record<string, unknown>; render: UnknownFunction }[] = [];
  const cleanups: UnknownFunction[] = [];
  const noRemoteCalls = (): never => {
    throw new Error("client registration must not call remote APIs");
  };
  const services = new Map<string, unknown>([
    ["remote.settings", { describe: noRemoteCalls, update: noRemoteCalls }],
    ["remote.session", { modelCatalog: noRemoteCalls }],
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
          options: object(options, "settings row options"),
          render: callable(render, "settings row renderer"),
        };
        rows.push(row);
        return () => {
          rows.splice(rows.indexOf(row), 1);
        };
      },
    },
  };
  apply(context);
  assert.deepEqual(injectedSlots, [SETTINGS_SLOT], "General settings slot injection");
  assert.equal(rows.length, 1, "client must register one General settings row");
  const row = rows[0];
  assert.ok(row, "General settings row is missing");
  assert.equal(row.options["name"], SETTINGS_SLOT, "settings row slot");
  assert.equal(row.options["id"], NAMESPACE, "settings row id");
  assert.equal(row.options["order"], 40, "settings row order");
  assert.equal(callable(row.options["label"], "settings row label")(), "Summary model");
  assert.ok(row.render() !== undefined, "settings row renderer must return an element");
  const dictionary = object(dictionaries.get(NAMESPACE), "registered locale dictionary");
  assert.equal(object(dictionary["zh"], "Chinese locale")["label"], "摘要模型");
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(rows.length, 0, "General settings row must unregister on disposal");
  assert.equal(dictionaries.size, 0, "locale must unregister on disposal");
}

function main(): void {
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
  checkClient(packagedPath(installed, "client.js", "built client entry"));
  console.log(
    `smoke-release: ${PACKAGE_ID} passed (main/types/exports/patch, client module/inject/apply, General row/locale/disposal)`,
  );
}

try {
  main();
} catch (error: unknown) {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
