// npm registry adapters.
import { run } from "./exec.mjs";

/**
 * Whether `<name>@<version>` is on the registry. A 404 means absent; any other
 * failure throws so it is never mistaken for absence.
 */
export function registryHas(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version", "--json"]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) {
    const text = result.stdout.trim();
    if (!text) {
      return false;
    }
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.includes(version) : value === version;
  }
  if (/\bE404\b/.test(output)) {
    return false;
  }
  throw new Error(`npm view ${name}@${version} failed (exit ${result.code})\n${output.trim()}`);
}

/** Uploads a tarball; returns `{ ok, output }`. */
export function npmPublish(tarball) {
  const result = run("npm", ["publish", tarball, "--access", "public"]);
  return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
}
