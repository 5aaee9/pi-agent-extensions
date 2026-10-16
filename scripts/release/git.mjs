// Read-only Git helpers shared by the release scripts.
import { run, runChecked } from "./exec.mjs";

export function git(args, cwd) {
  return runChecked("git", args, { cwd }).trimEnd();
}

/** Returns the contents of `<rev>:<path>`, or `null` when the commit lacks the path. */
export function showFile(rev, path, cwd) {
  const result = run("git", ["cat-file", "blob", `${rev}:${path}`], { cwd });
  if (result.code === 0) {
    return result.stdout;
  }
  // Distinguish "no such path in that commit" from an unreadable repository.
  const exists = run("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd });
  if (exists.code !== 0) {
    throw new Error(`git cannot resolve commit ${rev}\n${result.stderr.trim()}`);
  }
  return null;
}

/** Returns the parsed `version` of `<rev>:<dir>/package.json`, or `null` when absent. */
export function manifestVersionAt(rev, dir, cwd) {
  const text = showFile(rev, `${dir}/package.json`, cwd);
  if (text === null) {
    return null;
  }
  return JSON.parse(text).version ?? null;
}

/** Returns the commit a tag points at, or `null` when the tag does not exist. */
export function tagCommit(tag, cwd) {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], {
    cwd,
  });
  if (result.code === 0) {
    return result.stdout.trim();
  }
  if (result.code === 1 && !result.stderr.trim()) {
    return null;
  }
  throw new Error(`git rev-parse ${tag} failed\n${result.stderr.trim()}`);
}

/** Returns the first parent of a commit, or `null` for a root commit. */
export function firstParent(rev, cwd) {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `${rev}^1^{commit}`], { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}
