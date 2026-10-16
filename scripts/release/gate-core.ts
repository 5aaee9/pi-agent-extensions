// Pure decision logic of the pull-request release-impact gate.
import { findChangelogSection } from "./changelog.ts";

const ALWAYS_PUBLISHED = new Set(["package.json", "README.md", "LICENSE", "CHANGELOG.md"]);
const PREPARATION_FILES = new Set(["package.json", "CHANGELOG.md", "README.md"]);

/** Whether `relativePath` (inside the package directory) is published. */
export function isPublishedPath(relativePath: string, files: readonly string[] = []): boolean {
  if (ALWAYS_PUBLISHED.has(relativePath)) {
    return true;
  }
  return files.some((entry) => {
    const normalized = entry.replace(/^\.\//u, "").replace(/\/+$/u, "");
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

export interface GateInput {
  /** Paths relative to the package directory changed between the merge base and head. */
  readonly changedPaths: readonly string[];
  /** The head manifest's `files` allowlist. */
  readonly files: readonly string[];
  /** Manifest versions; `null` when the manifest is absent. */
  readonly baseVersion: string | null;
  readonly headVersion: string | null;
  /** CHANGELOG.md texts; `null` when absent. */
  readonly baseChangelog: string | null;
  readonly headChangelog: string | null;
  /** An intent naming the package was added or modified. */
  readonly touchedIntent: boolean;
  /** An intent naming the package was deleted. */
  readonly deletedIntent: boolean;
}

export type GateDecision =
  | { readonly status: "none"; readonly published: readonly string[] }
  | {
      readonly status: "pass" | "fail";
      readonly published: readonly string[];
      readonly reason: string;
    };

/** Decides whether the pull request records a release decision for one package. */
export function decidePackage(input: GateInput): GateDecision {
  const published = input.changedPaths.filter((path) => isPublishedPath(path, input.files));
  if (published.length === 0) {
    return { status: "none", published };
  }

  const { baseVersion, headVersion } = input;
  if (baseVersion === null || headVersion === null || baseVersion === headVersion) {
    return input.touchedIntent
      ? { status: "pass", published, reason: "intent added or modified" }
      : { status: "fail", published, reason: "no release decision for the published changes" };
  }

  const headSection = findChangelogSection(input.headChangelog ?? "", headVersion);
  const baseSection = findChangelogSection(input.baseChangelog ?? "", headVersion);
  const missing: string[] = [];
  if (!headSection.ok) {
    missing.push(`a single non-empty "## ${headVersion}" CHANGELOG.md section`);
  } else if (baseSection.count > 0) {
    missing.push(`a "## ${headVersion}" section that the base branch does not already have`);
  }
  if (!input.deletedIntent) {
    missing.push("a consumed (deleted) intent naming the package");
  }
  if (missing.length > 0) {
    return {
      status: "fail",
      published,
      reason: `version changed ${baseVersion} -> ${headVersion} without a release preparation (missing ${missing.join("; ")})`,
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
  return { status: "pass", published, reason: `release preparation for ${headVersion}` };
}

/** The message that tells an author how to record a decision for a package. */
export function decisionHelp(name: string): string {
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
