/**
 * Release smoke check for `@indexyz/dsh-autocompact`.
 *
 * The release engine packs this package, installs the tarball into an empty
 * directory, and runs `node test/smoke-release.ts <installed-package-dir>`. So
 * this checks the *installed* copy only: the files `main` and `exports` promise,
 * the Host half's built entry, and the packaged client artifact, which it
 * evaluates exactly the way the Harness page does — a real jsdom window
 * provides the page's `window.__ModuleLoader__.load({ id, factory })` contract,
 * and `factory` receives the real `react` / `react/jsx-runtime` modules the
 * page's module table provides. No `ComponentStub`, fake `createElement`, or
 * `runInNewContext` shim stands in for the browser plane.
 *
 * It uses Node built-ins and the repository's jsdom/React dev dependencies, so
 * the release engine runs it directly from TypeScript against the packed
 * tarball without credentials or network access. A missing file, a foreign
 * module request, or a broken registration exits non-zero with one line saying
 * what broke.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createBrowserWindow } from "./jsdom-types.ts";

/** The module id the client artifact must register. */
const PACKAGE_ID = "@indexyz/dsh-autocompact";

/** The modules the page's module table provides to every bundle. */
const MODULE_TABLE = ["react", "react/jsx-runtime"];

/** The module shape the loader contract hands to the page. */
interface ClientPlugin {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

/** One `window.__ModuleLoader__.load(...)` registration. */
interface Registration {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => ClientPlugin;
}

/** Stop with a non-zero exit and one line naming the invariant that broke. */
function fail(message: string): never {
  console.error(`smoke-release: ${message}`);
  process.exit(1);
}

function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${path} does not hold a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Every file an `exports` value points at, in declaration order. */
function exportTargets(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value);
  } else if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, into);
  }
  return into;
}

/** Resolve a package-relative specifier and require the file to be present. */
function packagedPath(dir: string, specifier: string, field: string): string {
  const relative = specifier.startsWith("./") ? specifier.slice(2) : specifier;
  if (relative === "" || relative.startsWith("/")) {
    fail(`package.json ${field} is not a package-relative path: ${specifier}`);
  }
  const path = join(dir, relative);
  if (!existsSync(path)) fail(`package.json ${field} points at a missing file: ${specifier}`);
  return path;
}

/** Load the client artifact through the loader contract the page implements. */
async function loadClientPlugin(
  installed: string,
): Promise<{ requested: string[]; plugin: ClientPlugin }> {
  const clientPath = join(installed, "client.js");
  if (!existsSync(clientPath)) fail(`the packaged client artifact is missing: ${clientPath}`);

  let registration: Registration | undefined;
  const window = createBrowserWindow();
  window.__ModuleLoader__ = {
    load(spec: Registration): void {
      registration = spec;
    },
  };
  window.eval(readFileSync(clientPath, "utf8"));

  const requested: string[] = [];
  // The page's module table provides the real React modules. The artifact is
  // evaluated in a real jsdom window, so a bundle that reached for anything
  // outside that table fails here exactly as it would in the page.
  const modules: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
  };
  const requireFromPage = (id: string): unknown => {
    requested.push(id);
    if (!MODULE_TABLE.includes(id)) {
      throw new Error(`client artifact requested a module outside the page's module table: ${id}`);
    }
    return modules[id];
  };

  if (registration === undefined) {
    fail("client.js did not register a module through window.__ModuleLoader__.load");
  }
  if (registration.id !== PACKAGE_ID) {
    fail(`client.js registered "${registration.id}", expected "${PACKAGE_ID}"`);
  }
  if (typeof registration.factory !== "function") {
    fail("client.js registered a module without a factory");
  }
  return { requested, plugin: registration.factory(requireFromPage) };
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === undefined) fail("usage: node test/smoke-release.ts <installed-package-dir>");
  const installed = resolve(argument);

  const manifestPath = join(installed, "package.json");
  if (!existsSync(manifestPath)) fail(`no package.json in ${installed}`);
  const manifest = readManifest(manifestPath);
  if (manifest["name"] !== PACKAGE_ID) {
    fail(`installed package is "${String(manifest["name"])}", expected "${PACKAGE_ID}"`);
  }

  const main = manifest["main"];
  if (typeof main !== "string") fail("package.json declares no main entry");
  packagedPath(installed, main, "main");
  for (const target of exportTargets(manifest["exports"])) {
    packagedPath(installed, target, "exports");
  }

  const hostEntry = join(installed, "lib", "index.js");
  if (!existsSync(hostEntry)) fail(`the Host half is missing its built entry: ${hostEntry}`);

  const { requested, plugin } = await loadClientPlugin(installed);
  if (plugin === null || typeof plugin !== "object") {
    fail("the client factory returned no module");
  }
  if (
    !Array.isArray(plugin.inject) ||
    plugin.inject.some((service) => typeof service !== "string")
  ) {
    fail("the client module does not export an inject service list");
  }
  if (typeof plugin.apply !== "function") {
    fail("the client module does not export an apply function");
  }

  const unexpected = requested.filter((id) => !MODULE_TABLE.includes(id));
  if (unexpected.length > 0) {
    fail(
      `the client artifact asks for modules the page does not provide: ${unexpected.join(", ")}`,
    );
  }

  console.log(`smoke-release: ${PACKAGE_ID} is intact (main/exports, lib/index.js, client.js)`);
}

main().catch((error: unknown) => {
  console.error(`smoke-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
