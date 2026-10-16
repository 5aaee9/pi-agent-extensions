// Pure decision logic of the pull-request release-impact gate.
import { findChangelogSection } from "./changelog.mjs";

const ALWAYS_PUBLISHED = new Set(["package.json", "README.md", "LICENSE", "CHANGELOG.md"]);
const PREPARATION_FILES = new Set(["package.json", "CHANGELOG.md", "README.md"]);

/** Whether `relativePath` (inside the package directory) is published. */
export function isPublishedPath(relativePath, files = []) {
  if (ALWAYS_PUBLISHED.has(relativePath)) {
    return true;
  }
  return files.some((entry) => {
    const normalized = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

/**
 * Decides, for one package, whether the pull request records a release
 * decision for its published changes.
 *
 * - `changedPaths`: paths relative to the package directory changed between the
 *   merge base and head.
 * - `files`: the head manifest's `files` allowlist.
 * - `baseVersion` / `headVersion`: manifest versions (`null` when absent).
 * - `baseChangelog` / `headChangelog`: CHANGELOG.md texts (`null` when absent).
 * - `touchedIntent`: an intent naming the package was added or modified.
 * - `deletedIntent`: an intent naming the package was deleted.
 *
 * Returns `{ status: "none" | "pass" | "fail", published, reason }`.
 */
export function decidePackage(input) {
  const published = input.changedPaths.filter((path) => isPublishedPath(path, input.files));
  if (published.length === 0) {
    return { status: "none", published };
  }

  const versionChanged =
    input.baseVersion !== null &&
    input.headVersion !== null &&
    input.baseVersion !== input.headVersion;
  if (!versionChanged) {
    return input.touchedIntent
      ? { status: "pass", published, reason: "intent added or modified" }
      : { status: "fail", published, reason: "no release decision for the published changes" };
  }

  const headSection = findChangelogSection(input.headChangelog ?? "", input.headVersion);
  const baseSection = findChangelogSection(input.baseChangelog ?? "", input.headVersion);
  const missing = [];
  if (!headSection.ok) {
    missing.push(`a single non-empty "## ${input.headVersion}" CHANGELOG.md section`);
  } else if (baseSection.count > 0) {
    missing.push(`a "## ${input.headVersion}" section that the base branch does not already have`);
  }
  if (!input.deletedIntent) {
    missing.push("a consumed (deleted) intent naming the package");
  }
  if (missing.length > 0) {
    return {
      status: "fail",
      published,
      reason: `version changed ${input.baseVersion} -> ${input.headVersion} without a release preparation (missing ${missing.join("; ")})`,
    };
  }

  const others = published.filter((path) => !PREPARATION_FILES.has(path));
  if (others.length > 0 && !input.touchedIntent) {
    return {
      status: "fail",
      published,
      reason: `a release preparation cannot carry other published changes (${others.join(", ")}); add an intent for them`,
    };
  }
  return { status: "pass", published, reason: `release preparation for ${input.headVersion}` };
}

/** The message that tells an author how to record a decision for a package. */
export function decisionHelp(name) {
  return [
    `  Record a release: npm run change -- --patch ${name} -m "<user-facing summary>" (or --minor / --major)`,
    `  Or no release: add .changeset/<id>.md containing`,
    `    ---`,
    `    "${name}": none`,
    `    ---`,
    ``,
    `    <why no release is needed>`,
  ].join("\n");
}
