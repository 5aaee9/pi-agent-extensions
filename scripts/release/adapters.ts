// Real Git, npm, and GitHub implementations of the plan and publish operations.
import { runChecked } from "./exec.ts";
import { manifestVersionAt, showFile, tagCommit } from "./git.ts";
import { createRelease, releaseState } from "./github.ts";
import { npmPublish, registryHas } from "./npm.ts";
import type { PlanOps, PlanReleaseState } from "./plan-core.ts";
import type { PublishOps } from "./publish-core.ts";
import { findVersionCommit } from "./version-commit.ts";
import { sha256File } from "./build.ts";

/** Plan operations; in a dry run an unanswerable Release lookup is "unknown". */
export function createPlanOps(cwd: string, head: string, dryRun: boolean): PlanOps {
  return {
    versionCommit: (pkg) => findVersionCommit({ cwd, head, dir: pkg.dir, version: pkg.version }),
    registryHas,
    tagCommit: (tag) => tagCommit(tag, cwd),
    manifestVersionAt: (commit, dir) => manifestVersionAt(commit, dir, cwd),
    changelogAt: (commit, dir) => showFile(commit, `${dir}/CHANGELOG.md`, cwd),
    releaseState: (tag): PlanReleaseState => {
      try {
        return releaseState(tag);
      } catch (error) {
        if (dryRun) {
          return "unknown";
        }
        throw error;
      }
    },
  };
}

/** Publish operations, logging to stdout. */
export function createPublishOps(cwd: string): PublishOps {
  return {
    sha256: sha256File,
    npmPublish,
    registryHas,
    tagCommit: (tag) => tagCommit(tag, cwd),
    manifestVersionAt: (commit, dir) => manifestVersionAt(commit, dir, cwd),
    createTag: (tag, commit) => {
      runChecked("git", ["tag", tag, commit], { cwd });
    },
    pushTag: (tag) => {
      runChecked("git", ["push", "origin", `refs/tags/${tag}`], { cwd });
    },
    changelogAt: (commit, dir) => showFile(commit, `${dir}/CHANGELOG.md`, cwd),
    releaseExists: (tag) => releaseState(tag) === "present",
    createRelease,
    log: (line) => {
      console.log(line);
    },
  };
}
