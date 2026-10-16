// Builds, inspects, and smoke-loads one upload at its version commit.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { errorMessage, run, runChecked } from "./exec.ts";
import { type Manifest, parseManifest } from "./json.ts";
import {
  inspectTarball,
  packedFilename,
  rpcAnswered,
  smokeCheck,
  type Upload,
} from "./plan-core.ts";
import type { BuiltUpload } from "./release-plan.ts";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Reads a package's manifest at its version commit. */
function manifestAt(worktree: string, upload: Upload): Manifest {
  const path = join(worktree, upload.dir, "package.json");
  return parseManifest(readFileSync(path, "utf8"), path);
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
function inspect(upload: Upload, manifest: Manifest, tarball: string): void {
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

/**
 * Installs the tarball as Pi installs packages; returns the install and package directories.
 *
 * A package the Harness installs declares its host packages as `"*"` peers and npm
 * resolves them against the registry while installing, which fails on prerelease
 * conflicts. Such a package is installed with `--legacy-peer-deps` instead: the
 * tarball still lands alone, and the declared smoke check decides whether it is usable.
 */
function installTarball(
  work: string,
  upload: Upload,
  tarball: string,
  peers: "omit" | "skip",
): { readonly installDir: string; readonly installed: string } {
  const installDir = join(work, "install");
  mkdirSync(installDir);
  writeFileSync(join(installDir, "package.json"), '{ "name": "release-smoke", "private": true }\n');
  const args = ["install", "--omit=peer", "--no-package-lock", "--no-audit", "--no-fund"];
  if (peers === "skip") {
    args.push("--legacy-peer-deps");
  }
  args.push(tarball);
  runChecked("npm", args, { cwd: installDir });
  return { installDir, installed: join(installDir, "node_modules", upload.name) };
}

/** Loads the installed copy in the pinned Pi host. */
function smokeLoadPi(
  worktree: string,
  work: string,
  upload: Upload,
  installDir: string,
  installed: string,
): void {
  const ownPi = join(worktree, upload.dir, "node_modules", ".bin", "pi");
  const pi = existsSync(ownPi) ? ownPi : join(worktree, "node_modules", ".bin", "pi");
  const agentDir = join(work, "agent");
  mkdirSync(agentDir);
  const smoke = run(pi, ["-ne", "-e", installed, "--mode", "rpc"], {
    cwd: installDir,
    input: '{"id":"1","type":"get_commands"}\n',
    env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir },
    timeout: 120_000,
  });
  if (smoke.code !== 0 || !rpcAnswered(smoke.stdout)) {
    const detail = (smoke.stderr || smoke.stdout).trim();
    throw new Error(`the installed tarball does not load in Pi\n${detail}`);
  }
}

/**
 * Runs a package's declared smoke script against the installed copy.
 *
 * The script runs from the version commit's worktree so the check itself is the
 * reviewed one, and receives the installed package directory as its only argument.
 * Its own output is the failure detail; see `docs/releases.md`.
 */
function smokeLoadDeclared(
  worktree: string,
  upload: Upload,
  script: string,
  installed: string,
): void {
  const path = join(worktree, upload.dir, script);
  if (!existsSync(path)) {
    throw new Error(
      `the declared release smoke script ${script} is missing from the version commit`,
    );
  }
  const smoke = run(process.execPath, [path, installed], { cwd: worktree, timeout: 120_000 });
  if (smoke.code !== 0) {
    const detail = (smoke.stderr || smoke.stdout).trim();
    throw new Error(`the installed tarball failed its declared release smoke check\n${detail}`);
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
    const manifest = manifestAt(worktree, upload);
    const smoke = smokeCheck(manifest);
    const tarball = pack(worktree, upload, out);
    inspect(upload, manifest, tarball);
    const { installDir, installed } = installTarball(
      work,
      upload,
      tarball,
      manifest.dsh ? "skip" : "omit",
    );
    if (smoke.kind === "declared") {
      smokeLoadDeclared(worktree, upload, smoke.script, installed);
    } else {
      smokeLoadPi(worktree, work, upload, installDir, installed);
    }
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
