// Builds, inspects, and smoke-loads one upload at its version commit.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { errorMessage, run, runChecked } from "./exec.ts";
import { parseManifest } from "./json.ts";
import { inspectTarball, packedFilename, rpcAnswered, type Upload } from "./plan-core.ts";
import type { BuiltUpload } from "./release-plan.ts";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Runs `npm ci` and `npm pack` in the worktree; returns the tarball path. */
function pack(worktree: string, upload: Upload, out: string): string {
  runChecked("npm", ["ci", "--no-audit", "--no-fund"], { cwd: worktree });
  const stdout = runChecked(
    "npm",
    ["pack", "--workspace", upload.name, "--pack-destination", out, "--json"],
    { cwd: worktree },
  );
  return join(out, packedFilename(stdout));
}

/** Checks the tarball against the manifest at the version commit. */
function inspect(worktree: string, upload: Upload, tarball: string): void {
  const manifestPath = join(worktree, upload.dir, "package.json");
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"), manifestPath);
  const packed = parseManifest(
    runChecked("tar", ["-xzOf", tarball, "package/package.json"]),
    `${tarball}:package/package.json`,
  );
  const problems = inspectTarball({
    name: upload.name,
    version: upload.version,
    files: manifest.files,
    piResources: manifest.piResources,
    entries: runChecked("tar", ["-tzf", tarball])
      .split("\n")
      .filter((entry) => entry !== "")
      .map((entry) => entry.replace(/^package\//u, "")),
    packed: { name: packed.name, version: packed.version },
  });
  if (problems.length > 0) {
    throw new Error(`tarball inspection failed:\n  ${problems.join("\n  ")}`);
  }
}

/** Installs the tarball as Pi installs packages (no peers) and loads it in the pinned host. */
function smokeLoad(worktree: string, work: string, upload: Upload, tarball: string): void {
  const install = join(work, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), '{ "name": "release-smoke", "private": true }\n');
  runChecked(
    "npm",
    ["install", "--omit=peer", "--no-package-lock", "--no-audit", "--no-fund", tarball],
    { cwd: install },
  );
  const ownPi = join(worktree, upload.dir, "node_modules", ".bin", "pi");
  const pi = existsSync(ownPi) ? ownPi : join(worktree, "node_modules", ".bin", "pi");
  const agentDir = join(work, "agent");
  mkdirSync(agentDir);
  const installed = join(install, "node_modules", upload.name);
  const smoke = run(pi, ["-ne", "-e", installed, "--mode", "rpc"], {
    cwd: install,
    input: '{"id":"1","type":"get_commands"}\n',
    env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir },
    timeout: 120_000,
  });
  if (smoke.code !== 0 || !rpcAnswered(smoke.stdout)) {
    const detail = (smoke.stderr || smoke.stdout).trim();
    throw new Error(`the installed tarball does not load in Pi\n${detail}`);
  }
}

/** Builds the upload in a temporary worktree at its version commit; `out` receives the tarball. */
export function buildUpload(upload: Upload, cwd: string, out: string): BuiltUpload {
  const label = `${upload.name}@${upload.version}`;
  const work = mkdtempSync(join(tmpdir(), "release-build-"));
  const worktree = join(work, "worktree");
  console.log(`building ${label} at ${upload.versionCommit.slice(0, 7)}`);
  runChecked("git", ["worktree", "add", "--quiet", "--detach", worktree, upload.versionCommit], {
    cwd,
  });
  try {
    const tarball = pack(worktree, upload, out);
    inspect(worktree, upload, tarball);
    smokeLoad(worktree, work, upload, tarball);
    const sha256 = sha256File(tarball);
    const name = basename(tarball);
    console.log(`verified ${label}: ${name} sha256 ${sha256}`);
    return { ...upload, tarball: name, sha256 };
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`, { cause: error });
  } finally {
    run("git", ["worktree", "remove", "--force", worktree], { cwd });
    rmSync(work, { recursive: true, force: true });
  }
}
