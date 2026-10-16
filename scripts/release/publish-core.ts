// Decisions of the publish step: upload verified tarballs, wait out registry
// propagation, then record every published version with its tag and GitHub
// Release.
import { findChangelogSection } from "./changelog.ts";
import { errorMessage } from "./exec.ts";
import type { NewRelease } from "./github.ts";
import type { PublishResult } from "./npm.ts";
import type { PlannedPackage } from "./plan-core.ts";
import {
  WAIT_BUDGET_MINUTES,
  createWaitBudget,
  waitUntilVisible,
  type WaitBudget,
  type WaitOps,
} from "./registry-wait.ts";

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
export interface PublishOps extends WaitOps {
  readonly sha256: (tarball: string) => string;
  readonly npmPublish: (tarball: string) => PublishResult;
  readonly tagCommit: (tag: string) => string | null;
  readonly manifestVersionAt: (commit: string, dir: string) => string | null;
  readonly createTag: (tag: string, commit: string) => void;
  readonly pushTag: (tag: string) => void;
  readonly changelogAt: (commit: string, dir: string) => string | null;
  readonly releaseExists: (tag: string) => boolean;
  readonly createRelease: (release: NewRelease) => void;
}

export type UploadOutcome =
  | "not planned"
  | "published"
  | "already published"
  | "failed"
  | "not attempted";
export type TagOutcome = "unchanged" | "created" | "existing" | "failed";
export type ReleaseOutcome = "unchanged" | "created" | "existing" | "none (no section)" | "failed";

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

/** One upload's outcome and, when it failed, the error to report. */
interface UploadAttempt {
  readonly outcome: UploadOutcome;
  readonly failure?: string;
}

/**
 * Uploads one tarball. npm refusing it as already published is not a failure:
 * the version exists, but the registry may not serve it yet, so that case is
 * waited for.
 */
function uploadOne(upload: PublishUpload, ops: PublishOps, budget: WaitBudget): UploadAttempt {
  const label = `${upload.name}@${upload.version}`;
  const result = ops.npmPublish(upload.tarball);
  if (result.ok) {
    return { outcome: "published" };
  }
  const failure = `${label}: npm publish failed\n${result.output}`;
  if (!ALREADY_PUBLISHED.test(result.output)) {
    return { outcome: "failed", failure };
  }
  try {
    if (waitUntilVisible(upload.name, upload.version, ops, budget)) {
      return { outcome: "already published" };
    }
    // npm refuses to overwrite the version, so the version is published: a
    // registry that still does not serve it is the failure to report.
    return {
      outcome: "failed",
      failure: `${label}: npm publish reports the version already published, but the registry still does not show it after ${WAIT_BUDGET_MINUTES} minutes; rerun the workflow to record it\n${result.output}`,
    };
  } catch (error) {
    return {
      outcome: "failed",
      failure: `${failure}\nregistry re-check failed: ${errorMessage(error)}`,
    };
  }
}

/** Uploads one at a time; the first failure stops later uploads. */
function uploadAll(
  uploads: readonly PublishUpload[],
  ops: PublishOps,
  budget: WaitBudget,
): UploadResults {
  const outcomes = new Map<string, UploadOutcome>();
  const uploaded: PublishUpload[] = [];
  const errors: string[] = [];
  for (const upload of uploads) {
    const label = `${upload.name}@${upload.version}`;
    if (errors.length > 0) {
      outcomes.set(upload.name, "not attempted");
      continue;
    }
    const attempt = uploadOne(upload, ops, budget);
    outcomes.set(upload.name, attempt.outcome);
    if (attempt.failure !== undefined) {
      errors.push(attempt.failure);
    }
    if (attempt.outcome !== "failed") {
      uploaded.push(upload);
      ops.log(
        attempt.outcome === "published" ? `published ${label}` : `${label} was already published`,
      );
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

/** Creates the GitHub Release when missing and the record commit has a section for that version. */
function ensureRelease(
  item: PublishRecord,
  tag: string,
  recordCommit: string,
  tagOutcome: TagOutcome,
  ops: PublishOps,
): ReleaseOutcome {
  const section = findChangelogSection(ops.changelogAt(recordCommit, item.dir) ?? "", item.version);
  if (!section.ok) {
    ops.log(`notice: ${tag}: ${section.reason}; no GitHub Release`);
    return "none (no section)";
  }
  if (ops.releaseExists(tag)) {
    return "existing";
  }
  // GitHub demands the `workflows` permission for a Release whose target SHA
  // differs from the default branch in `.github/workflows/**`, and the Actions
  // token can never hold it. A tag this run pushed still names its commit, in
  // case the API has not seen the new ref yet; a tag that already existed fixes
  // the commit by itself, so that Release is created without a target.
  const target = tagOutcome === "created" ? recordCommit : null;
  ops.createRelease({ tag, target, notes: section.body });
  ops.log(`released ${tag}`);
  return "created";
}

/** Records one version; `upload` is its outcome in this run. */
function recordVersion(
  item: PublishRecord,
  upload: UploadOutcome,
  ops: PublishOps,
  budget: WaitBudget,
): RecordResult {
  const tag = `${item.name}@${item.version}`;
  // Only a version this run uploaded (or the plan confirmed) is worth waiting
  // for; a failed or unattempted upload is expected to be absent, so one lookup
  // decides whether some other run published it.
  const expected = upload !== "failed" && upload !== "not attempted";
  let visible: boolean;
  try {
    visible = expected
      ? waitUntilVisible(item.name, item.version, ops, budget)
      : ops.registryHas(item.name, item.version);
  } catch (error) {
    return { tag: "unchanged", release: "unchanged", error: `${tag}: ${errorMessage(error)}` };
  }
  if (!visible) {
    if (!expected) {
      ops.log(`${tag} is not on the registry; not recorded`);
      return { tag: "unchanged", release: "unchanged" };
    }
    // The version was uploaded (or confirmed by the plan) but never appeared:
    // fail so a rerun finds it and creates the missing records.
    return {
      tag: "unchanged",
      release: "unchanged",
      error: `${tag}: not visible on the registry after ${WAIT_BUDGET_MINUTES} minutes of waiting; rerun the workflow to record it`,
    };
  }
  let recordCommit: string;
  let tagOutcome: TagOutcome;
  try {
    [recordCommit, tagOutcome] = ensureTag(item, tag, ops);
  } catch (error) {
    return { tag: "failed", release: "unchanged", error: `${tag}: ${errorMessage(error)}` };
  }
  try {
    return {
      tag: tagOutcome,
      release: ensureRelease(item, tag, recordCommit, tagOutcome, ops),
    };
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

  const budget = createWaitBudget(() => ops.now());
  const uploads = uploadAll(plan.uploads, ops, budget);
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
    const result = recordVersion(item, upload, ops, budget);
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
