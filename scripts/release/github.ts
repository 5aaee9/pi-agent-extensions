// GitHub Release adapters (through the gh CLI and GH_TOKEN).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run, runChecked } from "./exec.ts";

export type ReleaseState = "present" | "missing";

/** Returns whether the Release exists; throws on any other gh failure. */
export function releaseState(tag: string): ReleaseState {
  const result = run("gh", ["release", "view", tag, "--json", "tagName"]);
  if (result.code === 0) {
    return "present";
  }
  if (/release not found/iu.test(result.stderr)) {
    return "missing";
  }
  throw new Error(`gh release view ${tag} failed (exit ${result.code})\n${result.stderr.trim()}`);
}

export interface NewRelease {
  readonly tag: string;
  readonly target: string;
  readonly notes: string;
}

export function createRelease({ tag, target, notes }: NewRelease): void {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  try {
    const file = join(dir, "notes.md");
    writeFileSync(file, notes);
    runChecked("gh", [
      "release",
      "create",
      tag,
      "--target",
      target,
      "--title",
      tag,
      "--notes-file",
      file,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
