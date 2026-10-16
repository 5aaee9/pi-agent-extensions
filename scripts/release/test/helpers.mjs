// Temporary Git repositories for history-dependent tests.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }).trim();
  git("init", "--quiet", "--initial-branch=main");
  return {
    dir,
    git,
    write(path, content) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
      );
    },
    remove(path) {
      rmSync(join(dir, path));
    },
    commit(message) {
      git("add", "-A");
      git("commit", "--quiet", "--allow-empty", "-m", message);
      return git("rev-parse", "HEAD");
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function manifest(version, extra = {}) {
  return {
    name: "@indexyz/pi-a",
    version,
    files: ["index.ts", "README.md", "CHANGELOG.md", "LICENSE"],
    ...extra,
  };
}
