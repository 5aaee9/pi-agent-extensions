// Read-only Git helpers shared by the release scripts.
import { run, runChecked } from "./exec.ts";
import { parseManifest } from "./json.ts";

export function git(args: readonly string[], cwd?: string): string {
  return runChecked("git", args, cwd === undefined ? {} : { cwd }).trimEnd();
}

/** Returns the contents of `<rev>:<path>`, or `null` when the commit lacks the path. */
export function showFile(rev: string, path: string, cwd: string): string | null {
  const result = run("git", ["cat-file", "blob", `${rev}:${path}`], { cwd });
  if (result.code === 0) {
    return result.stdout;
  }
  // Distinguish "no such path in that commit" from an unresolvable commit.
  const exists = run("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd });
  if (exists.code !== 0) {
    throw new Error(`git cannot resolve commit ${rev}\n${result.stderr.trim()}`);
  }
  return null;
}

/** Returns the `version` of `<rev>:<dir>/package.json`, or `null` when absent. */
export function manifestVersionAt(rev: string, dir: string, cwd: string): string | null {
  const path = `${dir}/package.json`;
  const text = showFile(rev, path, cwd);
  if (text === null) {
    return null;
  }
  const { version } = parseManifest(text, `${rev}:${path}`);
  return version === "" ? null : version;
}

/** Returns the commit a tag points at, or `null` when the tag does not exist. */
export function tagCommit(tag: string, cwd: string): string | null {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], {
    cwd,
  });
  if (result.code === 0) {
    return result.stdout.trim();
  }
  if (result.code === 1 && result.stderr.trim() === "") {
    return null;
  }
  throw new Error(`git rev-parse ${tag} failed\n${result.stderr.trim()}`);
}

/** Returns the first parent of a commit, or `null` for a root commit. */
export function firstParent(rev: string, cwd: string): string | null {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `${rev}^1^{commit}`], { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}
