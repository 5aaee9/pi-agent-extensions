/**
 * Release smoke check for `@indexyz/dsh-custom-provider-reasoning-efforts`.
 *
 * The release engine packs this package, installs the tarball into an empty
 * directory, and runs `node test/smoke-release.ts <installed-package-dir>`. So
 * this checks the *installed* copy only: the manifest's name and version, every
 * `main` and `exports` target, the built host entry, and the bundle patch the
 * `dsh` manifest points at.
 *
 * The built entry imports the host packages the Harness supplies at runtime,
 * which the isolated install deliberately omits, so its export surface is
 * checked statically against the emitted `export { ... }` statement instead of
 * being imported here.
 *
 * It uses Node built-ins only and erasable syntax, so Node runs it directly
 * from TypeScript. A missing file, a wrong manifest, or a bundle patch that
 * does not mount this package exits non-zero with one line saying what broke.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The package the installed copy must be. */
const PACKAGE_ID = "@indexyz/dsh-custom-provider-reasoning-efforts";

/** The exports the Host half must carry. */
const HOST_EXPORTS = ["Config", "apply", "inject", "name"];

/** The row id the bundle patch must insert. */
const ROW_ID = "custom-provider-reasoning-efforts";

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

/** One `name:` value from a patch file, with optional quotes removed. */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/** Require the built host entry to export the plugin surface. */
function checkHostEntry(path: string): void {
  const text = readFileSync(path, "utf8");
  const exported = new Set<string>();
  for (const statement of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of (statement[1] ?? "").split(",")) {
      const name =
        entry
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? "";
      if (name.length > 0) exported.add(name);
    }
  }
  for (const declaration of text.matchAll(
    /export\s+(?:declare\s+)?(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    exported.add(declaration[1] ?? "");
  }
  const missing = HOST_EXPORTS.filter((name) => !exported.has(name));
  if (missing.length > 0) {
    fail(
      `${path} does not export ${missing.join(", ")} (found ${[...exported].sort().join(", ")})`,
    );
  }
}

/** Require the bundle patch to insert exactly one row for this package. */
function checkBundlePatch(path: string): void {
  const text = readFileSync(path, "utf8");
  if (!/- insert:/.test(text)) fail(`${path} has no insert block`);
  const names = [...text.matchAll(/^\s*name:\s*(.+?)\s*$/gm)].map((match) =>
    unquote(match[1] ?? ""),
  );
  if (names.length !== 1 || names[0] !== PACKAGE_ID) {
    fail(
      `${path} must insert exactly one row naming "${PACKAGE_ID}", found ${JSON.stringify(names)}`,
    );
  }
  const ids = [...text.matchAll(/^\s*- id:\s*(\S+)\s*$/gm)].map((match) => match[1] ?? "");
  if (ids.length !== 1 || ids[0] !== ROW_ID) {
    fail(`${path} must insert exactly one row with id "${ROW_ID}", found ${JSON.stringify(ids)}`);
  }
}

function main(): void {
  const argument = process.argv[2];
  if (argument === undefined) fail("usage: node test/smoke-release.ts <installed-package-dir>");
  const installed = resolve(argument);

  const manifestPath = join(installed, "package.json");
  if (!existsSync(manifestPath)) fail(`no package.json in ${installed}`);
  const manifest = readManifest(manifestPath);
  if (manifest["name"] !== PACKAGE_ID) {
    fail(`installed package is "${String(manifest["name"])}", expected "${PACKAGE_ID}"`);
  }
  const version = manifest["version"];
  if (typeof version !== "string" || version.length === 0) {
    fail("package.json declares no version");
  }

  const main = manifest["main"];
  if (typeof main !== "string") fail("package.json declares no main entry");
  packagedPath(installed, main, "main");
  for (const target of exportTargets(manifest["exports"])) {
    packagedPath(installed, target, "exports");
  }

  const dsh = manifest["dsh"];
  const bundle =
    dsh !== null && typeof dsh === "object" ? (dsh as { bundle?: unknown }).bundle : undefined;
  const patch =
    bundle !== null && typeof bundle === "object"
      ? (bundle as { patch?: unknown }).patch
      : undefined;
  if (typeof patch !== "string") fail("package.json declares no dsh.bundle.patch");
  const patchPath = packagedPath(installed, patch, "dsh.bundle.patch");

  const hostEntry = join(installed, "lib", "index.js");
  if (!existsSync(hostEntry)) fail(`the Host half is missing its built entry: ${hostEntry}`);
  checkHostEntry(hostEntry);
  checkBundlePatch(patchPath);

  console.log(
    `smoke-release: ${PACKAGE_ID}@${version} is intact (main/exports, lib/index.js, cordis.patch.yml)`,
  );
}

main();
