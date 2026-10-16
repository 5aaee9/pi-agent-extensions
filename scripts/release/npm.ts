// npm registry adapters.
import { run, type RunResult } from "./exec.ts";

/**
 * Interprets `npm view <name>@<version> version --json`. A 404 means absent; a
 * successful response must confirm the version. Anything else (another
 * failure, an empty or unexpected response) throws so it is never mistaken for
 * absence.
 */
export function interpretView(result: RunResult, name: string, version: string): boolean {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    if (/\bE404\b/u.test(output)) {
      return false;
    }
    throw new Error(`npm view ${name}@${version} failed (exit ${result.code})\n${output}`);
  }
  let value: unknown;
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

/**
 * The arguments of a registry lookup. The lookup decides what the registry
 * serves right now — the publish step waits on it for a version it has just
 * uploaded — so it revalidates with `--prefer-online`: npm shares its cache
 * with the upload, and a cached package document from before that upload would
 * keep answering that the version is absent.
 */
export function viewArgs(name: string, version: string): string[] {
  return ["view", `${name}@${version}`, "version", "--json", "--prefer-online"];
}

/** Whether `<name>@<version>` is on the registry (see `interpretView`). */
export function registryHas(name: string, version: string): boolean {
  const result = run("npm", viewArgs(name, version));
  return interpretView(result, name, version);
}

export interface PublishResult {
  readonly ok: boolean;
  readonly output: string;
}

/** Uploads a tarball. */
export function npmPublish(tarball: string): PublishResult {
  const result = run("npm", ["publish", tarball, "--access", "public"]);
  return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
}
