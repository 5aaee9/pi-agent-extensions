// npm registry adapters.
import { run } from "./exec.mjs";

/**
 * Interprets `npm view <name>@<version> version --json`. A 404 means absent; a
 * successful response must confirm the version. Anything else (another
 * failure, an empty or unexpected response) throws so it is never mistaken for
 * absence.
 */
export function interpretView(result, name, version) {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    if (/\bE404\b/.test(output)) {
      return false;
    }
    throw new Error(`npm view ${name}@${version} failed (exit ${result.code})\n${output}`);
  }
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    value = undefined;
  }
  if (value === version || (Array.isArray(value) && value.includes(version))) {
    return true;
  }
  throw new Error(
    `npm view ${name}@${version} returned an unexpected response: ${JSON.stringify(result.stdout.trim())}`,
  );
}

/** Whether `<name>@<version>` is on the registry (see `interpretView`). */
export function registryHas(name, version) {
  return interpretView(
    run("npm", ["view", `${name}@${version}`, "version", "--json"]),
    name,
    version,
  );
}

/** Uploads a tarball; returns `{ ok, output }`. */
export function npmPublish(tarball) {
  const result = run("npm", ["publish", tarball, "--access", "public"]);
  return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
}
