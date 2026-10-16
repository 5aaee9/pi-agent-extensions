// Pure decisions of the publication plan.
import { findChangelogSection } from "./changelog.mjs";

const short = (sha) => sha.slice(0, 7);

/**
 * Plans one package. `ops` supplies the facts:
 * `versionCommit(pkg)`, `registryHas(name, version)`, `tagCommit(tag)`,
 * `manifestVersionAt(commit, dir)`, `changelogAt(commit, dir)`, and
 * `releaseState(tag)` ("present" | "missing" | "unknown").
 *
 * Returns `{ errors, notices, upload, record }`.
 */
export function planPackage(pkg, ops) {
  const tag = `${pkg.name}@${pkg.version}`;
  const result = { errors: [], notices: [], upload: null, record: null };

  const versionCommit = ops.versionCommit(pkg);
  if (versionCommit === null) {
    result.errors.push(`${tag}: no first-parent commit introduced this version`);
    return result;
  }

  const published = ops.registryHas(pkg.name, pkg.version);
  const tagSha = ops.tagCommit(tag);
  if (tagSha !== null) {
    const tagged = ops.manifestVersionAt(tagSha, pkg.dir);
    if (tagged !== pkg.version) {
      result.errors.push(
        `${tag}: tag points at ${short(tagSha)}, whose ${pkg.dir}/package.json carries ${tagged ?? "no version"}; the tag is never moved`,
      );
      return result;
    }
  }
  const recordCommit = tagSha ?? versionCommit;

  if (!published) {
    const section = findChangelogSection(
      ops.changelogAt(versionCommit, pkg.dir) ?? "",
      pkg.version,
    );
    if (!section.ok) {
      result.errors.push(`${tag}: ${section.reason} at ${short(versionCommit)}`);
      return result;
    }
    result.upload = { name: pkg.name, dir: pkg.dir, version: pkg.version, versionCommit };
  }

  const recordSection =
    recordCommit === versionCommit && result.upload
      ? { ok: true }
      : findChangelogSection(ops.changelogAt(recordCommit, pkg.dir) ?? "", pkg.version);
  const release = recordSection.ok ? ops.releaseState(tag) : "not-applicable";
  if (release === "unknown") {
    result.notices.push(`${tag}: GitHub Release state unknown (no GitHub access in dry-run)`);
  }

  const needsTag = tagSha === null;
  // An unknown state (dry-run without GitHub access) is reported as work.
  const needsRelease = recordSection.ok && release !== "present";
  if (needsTag && !recordSection.ok) {
    result.notices.push(
      `${tag}: no exact "## ${pkg.version}" section; it gets a tag and no Release`,
    );
  }
  if (needsTag || needsRelease) {
    result.record = {
      name: pkg.name,
      dir: pkg.dir,
      version: pkg.version,
      versionCommit,
      recordCommit,
      needsTag,
      needsRelease,
    };
  }
  return result;
}

/** Plans every package; any error blocks the whole batch. */
export function planPackages(packages, ops) {
  const plan = { errors: [], notices: [], uploads: [], records: [] };
  for (const pkg of packages) {
    const result = planPackage(pkg, ops);
    plan.errors.push(...result.errors);
    plan.notices.push(...result.notices);
    if (result.upload) plan.uploads.push(result.upload);
    if (result.record) plan.records.push(result.record);
  }
  return plan;
}

/** Normalizes a manifest path entry (`./index.ts` -> `index.ts`). */
const normalize = (entry) => entry.replace(/^\.\//, "").replace(/\/+$/, "");

/** Paths a manifest declares as Pi resources. */
export function piResources(manifest) {
  const pi = manifest.pi ?? {};
  return ["extensions", "skills", "prompts", "themes"].flatMap((key) =>
    Array.isArray(pi[key]) ? pi[key].map(normalize) : [],
  );
}

/**
 * Inspects a packed tarball. `entries` are the tarball's paths without the
 * `package/` prefix; `packed` is its parsed package.json. Returns problems.
 */
export function inspectTarball({ name, version, manifest, entries, packed }) {
  const problems = [];
  const present = (path) => entries.some((entry) => entry === path || entry.startsWith(`${path}/`));
  for (const required of ["package.json", "README.md", "CHANGELOG.md", "LICENSE"]) {
    if (!entries.includes(required)) problems.push(`missing ${required}`);
  }
  for (const entry of (manifest.files ?? []).map(normalize)) {
    if (!present(entry)) problems.push(`missing "files" entry ${entry}`);
  }
  for (const entry of piResources(manifest)) {
    if (!present(entry)) problems.push(`missing Pi resource ${entry}`);
  }
  for (const entry of entries) {
    if (entry.startsWith("test/") || entry.startsWith("openspec/")) {
      problems.push(`unexpected ${entry}`);
    }
  }
  if (packed.name !== name || packed.version !== version) {
    problems.push(
      `packed manifest is ${packed.name}@${packed.version}, expected ${name}@${version}`,
    );
  }
  return problems;
}

/** Whether Pi's RPC output answered the `get_commands` request with id "1". */
export function rpcAnswered(stdout) {
  return stdout.split("\n").some((line) => {
    try {
      const message = JSON.parse(line);
      return message.id === "1" && message.type === "response" && message.success === true;
    } catch {
      return false;
    }
  });
}
