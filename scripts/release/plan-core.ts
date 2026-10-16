// Pure decisions of the publication plan.
import { findChangelogSection } from "./changelog.ts";
import type { ReleaseState } from "./github.ts";
import { isRecord } from "./json.ts";

const short = (sha: string): string => sha.slice(0, 7);

/** A package as the plan sees it. */
export interface PlannedPackage {
  readonly name: string;
  readonly dir: string;
  readonly version: string;
}

/** "unknown" means GitHub could not be asked (dry-run without access). */
export type PlanReleaseState = ReleaseState | "unknown";

/** The facts the plan reads from Git, npm, and GitHub. */
export interface PlanOps {
  readonly versionCommit: (pkg: PlannedPackage) => string | null;
  readonly registryHas: (name: string, version: string) => boolean;
  readonly tagCommit: (tag: string) => string | null;
  readonly manifestVersionAt: (commit: string, dir: string) => string | null;
  readonly changelogAt: (commit: string, dir: string) => string | null;
  readonly releaseState: (tag: string) => PlanReleaseState;
}

export interface Upload extends PlannedPackage {
  readonly versionCommit: string;
}

export interface RecordItem extends PlannedPackage {
  readonly versionCommit: string;
  readonly recordCommit: string;
  readonly needsTag: boolean;
  readonly needsRelease: boolean;
}

export interface PackagePlan {
  readonly errors: readonly string[];
  readonly notices: readonly string[];
  readonly upload: Upload | null;
  readonly record: RecordItem | null;
}

const failed = (error: string): PackagePlan => ({
  errors: [error],
  notices: [],
  upload: null,
  record: null,
});

/** The commit an existing tag points at (accepted only when it carries the version). */
function existingTag(
  pkg: PlannedPackage,
  tag: string,
  ops: PlanOps,
): { readonly commit: string | null } | { readonly error: string } {
  const commit = ops.tagCommit(tag);
  if (commit === null) {
    return { commit };
  }
  const tagged = ops.manifestVersionAt(commit, pkg.dir);
  if (tagged !== pkg.version) {
    return {
      error: `${tag}: tag points at ${short(commit)}, whose ${pkg.dir}/package.json carries ${tagged ?? "no version"}; the tag is never moved`,
    };
  }
  return { commit };
}

/** The record work for a published (or uploading) version. */
function recordWork(
  base: RecordItem,
  hasSection: boolean,
  ops: PlanOps,
): { readonly record: RecordItem | null; readonly notices: readonly string[] } {
  const tag = `${base.name}@${base.version}`;
  const release = hasSection ? ops.releaseState(tag) : undefined;
  const notices: string[] = [];
  if (release === "unknown") {
    notices.push(`${tag}: GitHub Release state unknown (no GitHub access in dry-run)`);
  }
  if (base.needsTag && !hasSection) {
    notices.push(`${tag}: no exact "## ${base.version}" section; it gets a tag and no Release`);
  }
  // An unknown state (dry-run without GitHub access) is reported as work.
  const needsRelease = release !== undefined && release !== "present";
  const record = base.needsTag || needsRelease ? { ...base, needsRelease } : null;
  return { record, notices };
}

/** Plans one package. */
export function planPackage(pkg: PlannedPackage, ops: PlanOps): PackagePlan {
  const tag = `${pkg.name}@${pkg.version}`;
  const versionCommit = ops.versionCommit(pkg);
  if (versionCommit === null) {
    return failed(`${tag}: no first-parent commit introduced this version`);
  }
  const published = ops.registryHas(pkg.name, pkg.version);
  const tagged = existingTag(pkg, tag, ops);
  if ("error" in tagged) {
    return failed(tagged.error);
  }
  const recordCommit = tagged.commit ?? versionCommit;
  const sectionAt = (commit: string): boolean =>
    findChangelogSection(ops.changelogAt(commit, pkg.dir) ?? "", pkg.version).ok;

  let upload: Upload | null = null;
  if (!published) {
    const section = findChangelogSection(
      ops.changelogAt(versionCommit, pkg.dir) ?? "",
      pkg.version,
    );
    if (!section.ok) {
      return failed(`${tag}: ${section.reason} at ${short(versionCommit)}`);
    }
    upload = { ...pkg, versionCommit };
  }

  const hasSection = (upload !== null && recordCommit === versionCommit) || sectionAt(recordCommit);
  const base: RecordItem = {
    ...pkg,
    versionCommit,
    recordCommit,
    needsTag: tagged.commit === null,
    needsRelease: false,
  };
  const { record, notices } = recordWork(base, hasSection, ops);
  return { errors: [], notices, upload, record };
}

export interface Plan {
  readonly errors: readonly string[];
  readonly notices: readonly string[];
  readonly uploads: readonly Upload[];
  readonly records: readonly RecordItem[];
}

/** Plans every package; any error blocks the whole batch. */
export function planPackages(packages: readonly PlannedPackage[], ops: PlanOps): Plan {
  const results = packages.map((pkg) => planPackage(pkg, ops));
  return {
    errors: results.flatMap((result) => result.errors),
    notices: results.flatMap((result) => result.notices),
    uploads: results.flatMap((result) => (result.upload === null ? [] : [result.upload])),
    records: results.flatMap((result) => (result.record === null ? [] : [result.record])),
  };
}

/** Normalizes a manifest path entry (`./index.ts` -> `index.ts`). */
const normalize = (entry: string): string => entry.replace(/^\.\//u, "").replace(/\/+$/u, "");

export interface TarballFacts {
  readonly name: string;
  readonly version: string;
  /** The `files` allowlist and Pi resource paths of the manifest at the version commit. */
  readonly files: readonly string[];
  readonly piResources: readonly string[];
  /** The tarball's paths without the `package/` prefix. */
  readonly entries: readonly string[];
  /** The name and version of the packed package.json. */
  readonly packed: { readonly name: string; readonly version: string };
}

/** Inspects a packed tarball; returns the problems found. */
export function inspectTarball(facts: TarballFacts): string[] {
  const { entries } = facts;
  const present = (path: string): boolean =>
    entries.some((entry) => entry === path || entry.startsWith(`${path}/`));
  const problems: string[] = [];
  for (const required of ["package.json", "README.md", "CHANGELOG.md", "LICENSE"]) {
    if (!entries.includes(required)) {
      problems.push(`missing ${required}`);
    }
  }
  for (const entry of facts.files.map(normalize)) {
    if (!present(entry)) {
      problems.push(`missing "files" entry ${entry}`);
    }
  }
  for (const entry of facts.piResources.map(normalize)) {
    if (!present(entry)) {
      problems.push(`missing Pi resource ${entry}`);
    }
  }
  for (const entry of entries) {
    if (entry.startsWith("test/") || entry.startsWith("openspec/")) {
      problems.push(`unexpected ${entry}`);
    }
  }
  const { packed } = facts;
  if (packed.name !== facts.name || packed.version !== facts.version) {
    problems.push(
      `packed manifest is ${packed.name}@${packed.version}, expected ${facts.name}@${facts.version}`,
    );
  }
  return problems;
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Whether Pi's RPC output answered the `get_commands` request with id "1". */
export function rpcAnswered(stdout: string): boolean {
  return stdout.split("\n").some((line) => {
    const message = parseJsonLine(line);
    return (
      isRecord(message) &&
      message["id"] === "1" &&
      message["type"] === "response" &&
      message["success"] === true
    );
  });
}

/**
 * Returns the tarball file name from `npm pack --json` output, which lifecycle
 * scripts (prepack) may precede on stdout; the JSON array is printed last.
 */
export function packedFilename(stdout: string): string {
  const text = stdout.trimEnd();
  const start = text.startsWith("[") ? 0 : text.lastIndexOf("\n[") + 1;
  if (start === 0 && !text.startsWith("[")) {
    throw new Error("npm pack printed no JSON result");
  }
  const value: unknown = JSON.parse(text.slice(start));
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  const filename = isRecord(first) ? first["filename"] : undefined;
  if (typeof filename !== "string" || filename === "") {
    throw new Error("npm pack printed no tarball file name");
  }
  return filename.split("/").pop() ?? filename;
}
