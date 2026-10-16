// Parses and validates release intent files (`.changeset/<id>.md`).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseChangesetFile } from "@changesets/parse";
import { readChangesets } from "@changesets/read";
import type { Release } from "@changesets/types";

import { errorMessage } from "./exec.ts";

const IGNORED = new Set(["readme.md", "agents.md", "claude.md", "gemini.md"]);

/** Whether a path inside `.changeset/` is an intent file, as changesets reads them. */
export function isIntentPath(path: string): boolean {
  const match = /^\.changeset\/(?<file>[^/]+)$/u.exec(path);
  const file = match?.groups?.["file"];
  if (file === undefined) {
    return false;
  }
  return file.endsWith(".md") && !file.startsWith(".") && !IGNORED.has(file.toLowerCase());
}

export type ParsedIntent =
  | { readonly ok: true; readonly releases: readonly Release[]; readonly summary: string }
  | { readonly ok: false; readonly error: string };

/** Parses an intent file. */
export function parseIntent(text: string): ParsedIntent {
  try {
    const { releases, summary } = parseChangesetFile(text);
    return { ok: true, releases, summary };
  } catch (error) {
    return { ok: false, error: errorMessage(error).split("\n")[0] ?? "unparseable intent" };
  }
}

/**
 * Validates one intent against the workspace package names. Returns the
 * problems found; an empty list means the intent is valid.
 */
export function validateIntent(
  path: string,
  text: string,
  packageNames: readonly string[],
): string[] {
  const parsed = parseIntent(text);
  if (!parsed.ok) {
    return [`${path}: ${parsed.error}`];
  }
  const problems: string[] = [];
  if (parsed.releases.length !== 1) {
    problems.push(
      `${path}: names ${parsed.releases.length} packages; record exactly one package per intent file`,
    );
  }
  for (const release of parsed.releases) {
    if (!packageNames.includes(release.name)) {
      problems.push(`${path}: "${release.name}" is not a publishable workspace package`);
    }
  }
  if (parsed.summary.trim() === "") {
    problems.push(`${path}: the summary is empty`);
  }
  return problems;
}

/** The single package an intent names, or `undefined` when it is invalid. */
export function intentPackage(text: string): string | undefined {
  const parsed = parseIntent(text);
  if (!parsed.ok || parsed.releases.length !== 1) {
    return undefined;
  }
  return parsed.releases[0]?.name;
}

/** Validates every intent file on disk the way changesets reads them. */
export async function validateIntentFiles(
  cwd: string,
  packageNames: readonly string[],
): Promise<string[]> {
  let intents;
  try {
    intents = await readChangesets(cwd);
  } catch (error) {
    return [`cannot read release intents: ${errorMessage(error)}`];
  }
  const problems: string[] = [];
  for (const { id } of intents) {
    const path = `.changeset/${id}.md`;
    problems.push(...validateIntent(path, readFileSync(join(cwd, path), "utf8"), packageNames));
  }
  return problems;
}
