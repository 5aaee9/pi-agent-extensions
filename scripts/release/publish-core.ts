// Decisions of the publish step: upload verified tarballs, then record every
// published version with its tag and GitHub Release.
import { findChangelogSection } from "./changelog.ts";
import { errorMessage } from "./exec.ts";
import type { NewRelease } from "./github.ts";
import type { PublishResult } from "./npm.ts";
import type { PlannedPackage } from "./plan-core.ts";

const ALREADY_PUBLISHED = /cannot publish over the previously published versions?/iu;
const short = (sha: string): string => sha.slice(0, 7);

/** An upload whose tarball path is resolved. */
export interface PublishUpload extends PlannedPackage {
  readonly versionCommit: string;
  readonly tarball: string;
  readonly sha256: string;
}

/** A package to record; only its version commit is needed. */
export interface PublishRecord extends PlannedPackage {
  readonly versionCommit: string;
}

export interface PublishPlan {
  readonly uploads: readonly PublishUpload[];
  readonly records: readonly PublishRecord[];
}

/** The side effects and facts the publish step uses. */
export interface PublishOps {
  readonly sha256: (tarball: string) => string;
  readonly npmPublish: (tarball: string) => PublishResult;
  readonly registryHas: (name: string, version: string) => boolean;
  readonly tagCommit: (tag: string) => string | null;
  readonly manifestVersionAt: (commit: string, dir: string) => string | null;
  readonly createTag: (tag: string, commit: string) => void;
  readonly pushTag: (tag: string) => void;
  readonly changelogAt: (commit: string, dir: string) => string | null;
  readonly releaseExists: (tag: string) => boolean;
  readonly createRelease: (release: NewRelease) => void;
  readonly log: (line: string) => void;
}

export type UploadOutcome =
  | "not planned"
  | "published"
  | "already published"
  | "failed"
  | "not attempted";
export type TagOutcome = "unchanged" | "created" | "existing" | "failed";
export type ReleaseOutcome =
  | "unchanged"
  | "created"
  | "existing"
  | "none (no exact section)"
  | "failed";

export interface Outcome {
  readonly name: string;
  readonly version: string;
  readonly upload: UploadOutcome;
  readonly tag: TagOutcome;
  readonly release: ReleaseOutcome;
}

export interface PublishReport {
  readonly ok: boolean;
  /** One outcome per package, in the order they were visited. */
  readonly outcomes: readonly Outcome[];
  readonly errors: readonly string[];
}

interface UploadResults {
  readonly outcomes: ReadonlyMap<string, UploadOutcome>;
  readonly uploaded: readonly PublishUpload[];
  readonly errors: readonly string[];
}

/** Uploads one at a time; the first failure stops later uploads. */
function uploadAll(uploads: readonly PublishUpload[], ops: PublishOps): UploadResults {
  const outcomes = new Map<string, UploadOutcome>();
  const uploaded: PublishUpload[] = [];
  const errors: string[] = [];
  for (const upload of uploads) {
    const label = `${upload.name}@${upload.version}`;
    if (errors.length > 0) {
      outcomes.set(upload.name, "not attempted");
      continue;
    }
    const result = ops.npmPublish(upload.tarball);
    let outcome: UploadOutcome = "published";
    if (!result.ok) {
      outcome = "failed";
      let failure = `${label}: npm publish failed\n${result.output}`;
      if (ALREADY_PUBLISHED.test(result.output)) {
        try {
          outcome = ops.registryHas(upload.name, upload.version) ? "already published" : "failed";
        } catch (error) {
          failure += `\nregistry re-check failed: ${errorMessage(error)}`;
        }
      }
      if (outcome === "failed") {
        errors.push(failure);
      }
    }
    outcomes.set(upload.name, outcome);
    if (outcome !== "failed") {
      uploaded.push(upload);
      ops.log(outcome === "published" ? `published ${label}` : `${label} was already published`);
    }
  }
  return { outcomes, uploaded, errors };
}

interface RecordResult {
  readonly tag: TagOutcome;
  readonly release: ReleaseOutcome;
  readonly error?: string;
}

/** Creates the tag when missing; returns the record commit (the tag's commit). */
function ensureTag(item: PublishRecord, tag: string, ops: PublishOps): [string, TagOutcome] {
  const existing = ops.tagCommit(tag);
  if (existing === null) {
    ops.createTag(tag, item.versionCommit);
    ops.pushTag(tag);
    ops.log(`tagged ${tag} at ${short(item.versionCommit)}`);
    return [item.versionCommit, "created"];
  }
  const tagged = ops.manifestVersionAt(existing, item.dir);
  if (tagged !== item.version) {
    throw new Error(
      `tag points at ${short(existing)}, whose ${item.dir}/package.json carries ${tagged ?? "no version"}; the tag is never moved`,
    );
  }
  return [existing, "existing"];
}

/** Creates the GitHub Release when missing and the record commit has an exact section. */
function ensureRelease(
  item: PublishRecord,
  tag: string,
  recordCommit: string,
  ops: PublishOps,
): ReleaseOutcome {
  const section = findChangelogSection(ops.changelogAt(recordCommit, item.dir) ?? "", item.version);
  if (!section.ok) {
    ops.log(`notice: ${tag}: ${section.reason}; no GitHub Release`);
    return "none (no exact section)";
  }
  if (ops.releaseExists(tag)) {
    return "existing";
  }
  ops.createRelease({ tag, target: recordCommit, notes: section.body });
  ops.log(`released ${tag}`);
  return "created";
}

/** Records one version; `upload` is its outcome in this run. */
function recordVersion(item: PublishRecord, upload: UploadOutcome, ops: PublishOps): RecordResult {
  const tag = `${item.name}@${item.version}`;
  try {
    if (!ops.registryHas(item.name, item.version)) {
      if (upload === "failed" || upload === "not attempted") {
        ops.log(`${tag} is not on the registry; not recorded`);
        return { tag: "unchanged", release: "unchanged" };
      }
      // Published (or planned as published) but not visible yet: fail so a
      // rerun creates the missing records instead of reporting success.
      throw new Error("not visible on the registry yet; rerun the workflow to record it");
    }
  } catch (error) {
    return { tag: "unchanged", release: "unchanged", error: `${tag}: ${errorMessage(error)}` };
  }
  let recordCommit: string;
  let tagOutcome: TagOutcome;
  try {
    [recordCommit, tagOutcome] = ensureTag(item, tag, ops);
  } catch (error) {
    return { tag: "failed", release: "unchanged", error: `${tag}: ${errorMessage(error)}` };
  }
  try {
    return { tag: tagOutcome, release: ensureRelease(item, tag, recordCommit, ops) };
  } catch (error) {
    return { tag: tagOutcome, release: "failed", error: `${tag}: ${errorMessage(error)}` };
  }
}

/** Runs the publish step for a release plan. */
export function runPublish(plan: PublishPlan, ops: PublishOps): PublishReport {
  const mismatch = plan.uploads.find((upload) => ops.sha256(upload.tarball) !== upload.sha256);
  if (mismatch !== undefined) {
    return {
      ok: false,
      outcomes: [],
      errors: [`${mismatch.tarball}: SHA-256 does not match the plan; nothing was uploaded`],
    };
  }

  const uploads = uploadAll(plan.uploads, ops);
  const candidates: PublishRecord[] = [...plan.records];
  for (const upload of uploads.uploaded) {
    if (!candidates.some((record) => record.name === upload.name)) {
      candidates.push(upload);
    }
  }

  const outcomes = new Map<string, Outcome>();
  for (const upload of plan.uploads) {
    const outcome = uploads.outcomes.get(upload.name) ?? "not planned";
    outcomes.set(upload.name, {
      name: upload.name,
      version: upload.version,
      upload: outcome,
      tag: "unchanged",
      release: "unchanged",
    });
  }
  const errors = [...uploads.errors];
  for (const item of candidates) {
    const upload = uploads.outcomes.get(item.name) ?? "not planned";
    const result = recordVersion(item, upload, ops);
    outcomes.set(item.name, {
      name: item.name,
      version: item.version,
      upload,
      tag: result.tag,
      release: result.release,
    });
    if (result.error !== undefined) {
      errors.push(result.error);
    }
  }

  return { ok: errors.length === 0, outcomes: [...outcomes.values()], errors };
}
