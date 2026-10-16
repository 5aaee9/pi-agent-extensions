// The release-plan.json document that plan.ts writes and publish.ts reads.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { isRecord } from "./json.ts";
import type { RecordItem, Upload } from "./plan-core.ts";

export interface BuiltUpload extends Upload {
  /** The tarball file name inside the plan directory. */
  readonly tarball: string;
  readonly sha256: string;
}

export interface ReleasePlan {
  /** The commit the plan was computed from. */
  readonly commit: string;
  readonly uploads: readonly BuiltUpload[];
  readonly records: readonly RecordItem[];
}

function stringField(value: Readonly<Record<string, unknown>>, key: string, where: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") {
    throw new TypeError(`release-plan.json: ${where}.${key} must be a non-empty string`);
  }
  return field;
}

function booleanField(
  value: Readonly<Record<string, unknown>>,
  key: string,
  where: string,
): boolean {
  const field = value[key];
  if (typeof field !== "boolean") {
    throw new TypeError(`release-plan.json: ${where}.${key} must be a boolean`);
  }
  return field;
}

function list(value: unknown, where: string): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || !value.every((item) => isRecord(item))) {
    throw new TypeError(`release-plan.json: ${where} must be an array of objects`);
  }
  return value;
}

/** Parses and validates a release-plan.json document. */
export function parseReleasePlan(text: string): ReleasePlan {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new TypeError("release-plan.json must be a JSON object");
  }
  const uploads = list(value["uploads"], "uploads").map((item, index): BuiltUpload => {
    const where = `uploads[${index}]`;
    return {
      name: stringField(item, "name", where),
      dir: stringField(item, "dir", where),
      version: stringField(item, "version", where),
      versionCommit: stringField(item, "versionCommit", where),
      tarball: stringField(item, "tarball", where),
      sha256: stringField(item, "sha256", where),
    };
  });
  const records = list(value["records"], "records").map((item, index): RecordItem => {
    const where = `records[${index}]`;
    return {
      name: stringField(item, "name", where),
      dir: stringField(item, "dir", where),
      version: stringField(item, "version", where),
      versionCommit: stringField(item, "versionCommit", where),
      recordCommit: stringField(item, "recordCommit", where),
      needsTag: booleanField(item, "needsTag", where),
      needsRelease: booleanField(item, "needsRelease", where),
    };
  });
  return { commit: stringField(value, "commit", "plan"), uploads, records };
}

const PLAN_FILE = "release-plan.json";

/** Resolves (or creates a temporary) plan directory and makes sure it exists. */
export function prepareOutputDir(out: string | undefined): string {
  const dir = resolve(out ?? mkdtempSync(join(tmpdir(), "release-plan-")));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes the plan into its directory and returns the file path. */
export function writeReleasePlan(dir: string, plan: ReleasePlan): string {
  const path = join(dir, PLAN_FILE);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}

/** Reads the plan from its directory. */
export function readReleasePlan(dir: string): ReleasePlan {
  return parseReleasePlan(readFileSync(join(dir, PLAN_FILE), "utf8"));
}

/** Appends `name=value` to a GitHub Actions file (GITHUB_OUTPUT, GITHUB_STEP_SUMMARY). */
export function appendGithubFile(path: string, text: string): void {
  appendFileSync(path, text);
}
