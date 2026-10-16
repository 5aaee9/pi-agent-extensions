// Decisions of the publish step: upload verified tarballs, then record every
// published version with its tag and GitHub Release.
import { findChangelogSection } from "./changelog.mjs";

const ALREADY_PUBLISHED = /cannot publish over the previously published versions?/i;
const short = (sha) => sha.slice(0, 7);

/**
 * Runs the publish step for a release plan. `ops` supplies:
 * `sha256(tarball)`, `npmPublish(tarball)` -> `{ ok, output }`,
 * `registryHas(name, version)`, `tagCommit(tag)`, `manifestVersionAt(commit, dir)`,
 * `createTag(tag, commit)`, `pushTag(tag)`, `changelogAt(commit, dir)`,
 * `releaseExists(tag)`, `createRelease({ tag, target, notes })`, and `log(line)`.
 *
 * Returns `{ ok, outcomes, errors }`; `outcomes` maps each package name to
 * `{ version, upload, tag, release }` states for the report.
 */
export function runPublish(plan, ops) {
  const outcomes = new Map();
  const errors = [];
  const outcome = (item) => {
    if (!outcomes.has(item.name)) {
      outcomes.set(item.name, {
        version: item.version,
        upload: "not planned",
        tag: "unchanged",
        release: "unchanged",
      });
    }
    return outcomes.get(item.name);
  };

  for (const upload of plan.uploads) {
    if (ops.sha256(upload.tarball) !== upload.sha256) {
      return {
        ok: false,
        outcomes,
        errors: [`${upload.tarball}: SHA-256 does not match the plan; nothing was uploaded`],
      };
    }
  }

  const uploaded = [];
  let uploadFailed = false;
  for (const upload of plan.uploads) {
    const state = outcome(upload);
    const label = `${upload.name}@${upload.version}`;
    if (uploadFailed) {
      state.upload = "not attempted";
      continue;
    }
    const result = ops.npmPublish(upload.tarball);
    if (result.ok) {
      state.upload = "published";
      uploaded.push(upload);
      ops.log(`published ${label}`);
      continue;
    }
    let failure = `${label}: npm publish failed\n${result.output}`;
    if (ALREADY_PUBLISHED.test(result.output)) {
      try {
        if (ops.registryHas(upload.name, upload.version)) {
          state.upload = "already published";
          uploaded.push(upload);
          ops.log(`${label} was already published`);
          continue;
        }
      } catch (error) {
        failure += `\nregistry re-check failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    state.upload = "failed";
    uploadFailed = true;
    errors.push(failure);
  }

  const candidates = [...plan.records];
  for (const upload of uploaded) {
    if (!candidates.some((record) => record.name === upload.name)) candidates.push(upload);
  }

  for (const item of candidates) {
    const state = outcome(item);
    const tag = `${item.name}@${item.version}`;
    // The record step that failed, for the report; a registry failure is neither.
    let step;
    try {
      if (!ops.registryHas(item.name, item.version)) {
        if (state.upload === "failed" || state.upload === "not attempted") {
          ops.log(`${tag} is not on the registry; not recorded`);
          continue;
        }
        // Published (or planned as published) but not visible yet: fail so a
        // rerun creates the missing records instead of reporting success.
        throw new Error("not visible on the registry yet; rerun the workflow to record it");
      }
      step = "tag";
      let recordCommit = ops.tagCommit(tag);
      if (recordCommit === null) {
        ops.createTag(tag, item.versionCommit);
        ops.pushTag(tag);
        recordCommit = item.versionCommit;
        state.tag = "created";
        ops.log(`tagged ${tag} at ${short(recordCommit)}`);
      } else {
        const tagged = ops.manifestVersionAt(recordCommit, item.dir);
        if (tagged !== item.version) {
          throw new Error(
            `tag points at ${short(recordCommit)}, whose ${item.dir}/package.json carries ${tagged ?? "no version"}; the tag is never moved`,
          );
        }
        state.tag = "existing";
      }

      step = "release";
      const section = findChangelogSection(
        ops.changelogAt(recordCommit, item.dir) ?? "",
        item.version,
      );
      if (!section.ok) {
        state.release = "none (no exact section)";
        ops.log(`notice: ${tag}: ${section.reason}; no GitHub Release`);
        continue;
      }
      if (ops.releaseExists(tag)) {
        state.release = "existing";
        continue;
      }
      ops.createRelease({ tag, target: recordCommit, notes: section.body });
      state.release = "created";
      ops.log(`released ${tag}`);
    } catch (error) {
      if (step) state[step] = "failed";
      errors.push(`${tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: !uploadFailed && errors.length === 0, outcomes, errors };
}
