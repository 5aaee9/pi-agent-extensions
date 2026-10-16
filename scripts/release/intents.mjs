// Parses and validates release intent files (`.changeset/<id>.md`).
import { parseChangesetFile } from "@changesets/parse";

const IGNORED = new Set(["readme.md", "agents.md", "claude.md", "gemini.md"]);

/** Whether a path inside `.changeset/` is an intent file, as changesets reads them. */
export function isIntentPath(path) {
  const match = /^\.changeset\/([^/]+)$/.exec(path);
  if (!match) {
    return false;
  }
  const file = match[1];
  return file.endsWith(".md") && !file.startsWith(".") && !IGNORED.has(file.toLowerCase());
}

/** Parses an intent file; returns `{ releases, summary }` or `{ error }`. */
export function parseIntent(text) {
  try {
    return parseChangesetFile(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

/**
 * Validates one intent against the workspace package names. Returns a list of
 * problems; an empty list means the intent is valid.
 */
export function validateIntent(path, text, packageNames) {
  const parsed = parseIntent(text);
  if (parsed.error) {
    return [`${path}: ${parsed.error}`];
  }
  const problems = [];
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
  if (!parsed.summary.trim()) {
    problems.push(`${path}: the summary is empty`);
  }
  return problems;
}

/** The single package an intent names, or `undefined` when it is invalid. */
export function intentPackage(text) {
  const parsed = parseIntent(text);
  return parsed.error || parsed.releases.length !== 1 ? undefined : parsed.releases[0].name;
}
