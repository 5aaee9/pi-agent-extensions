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
  /**
   * The commit the Release's tag is created from, or `null` when the tag
   * already exists and fixes the commit itself.
   */
  readonly target: string | null;
  readonly notes: string;
}

export function createRelease({ tag, target, notes }: NewRelease): void {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  try {
    const file = join(dir, "notes.md");
    writeFileSync(file, notes);
    const args = ["release", "create", tag, "--title", tag, "--notes-file", file];
    if (target !== null) {
      args.push("--target", target);
    }
    runChecked("gh", args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
