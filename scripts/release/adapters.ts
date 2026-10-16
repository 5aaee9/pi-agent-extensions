// Real Git, npm, and GitHub implementations of the plan and publish operations.
import { performance } from "node:perf_hooks";

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
    // Monotonic elapsed time: the wait budget is a hard ceiling, and a wall
    // clock a time correction moves backwards would extend it.
    now: () => performance.now(),
    sleep: (ms) => {
      // The whole engine is synchronous (`spawnSync`, `gh`), and the publish job
      // has nothing else to do while it waits out registry propagation, so the
      // sleep blocks without spinning instead of turning the step asynchronous.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    },
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
