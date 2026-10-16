// Command doubles for the publish step's tests.
import assert from "node:assert/strict";

import type { PublishResult } from "../npm.ts";
import type {
  Outcome,
  PublishOps,
  PublishRecord,
  PublishReport,
  PublishUpload,
} from "../publish-core.ts";

export const V0 = "0000000000000000000000000000000000000000";
export const V1 = "1111111111111111111111111111111111111111";
export const V2 = "2222222222222222222222222222222222222222";

export const section = (version: string, line: string): string =>
  `# Changelog\n\n## ${version}\n\n### Patch Changes\n\n${line}\n\n## 0.1.43 - 2026-10-11\n\n- Old.\n`;

interface CommitFacts {
  readonly version: string;
  readonly changelog?: string;
}

interface UploadBehaviour {
  readonly ok: boolean;
  readonly output?: string;
  /** A version the registry shows once this upload succeeds. */
  readonly adds?: string;
}

export interface World {
  readonly commits?: Readonly<Record<string, CommitFacts>>;
  readonly tags?: Readonly<Record<string, string>>;
  /** Published versions, or "error" when every lookup fails. */
  readonly registry?: readonly string[] | "error";
  readonly releases?: readonly string[];
  readonly publish?: Readonly<Record<string, UploadBehaviour>>;
  readonly hashes?: Readonly<Record<string, string>>;
  readonly failingViews?: readonly string[];
  readonly failingPush?: boolean;
}

/** Collects what the doubles observe. */
interface Recorder {
  readonly action: (line: string) => void;
  readonly view: (spec: string) => void;
}

export interface Doubles {
  readonly ops: PublishOps;
  /** Side effects, in order. */
  readonly actions: readonly string[];
  /** Registry lookups, in order. */
  readonly views: readonly string[];
}

/** Registry doubles: uploads may add versions; lookups may fail. */
function registryOps(
  facts: World,
  recorder: Recorder,
): Pick<PublishOps, "npmPublish" | "registryHas" | "sha256"> {
  const registry = facts.registry === "error" ? "error" : [...(facts.registry ?? [])];
  return {
    sha256: (tarball) => facts.hashes?.[tarball] ?? "good",
    npmPublish: (tarball): PublishResult => {
      recorder.action(`npm publish ${tarball}`);
      const outcome = facts.publish?.[tarball] ?? { ok: true };
      if (outcome.ok && outcome.adds !== undefined && registry !== "error") {
        registry.push(outcome.adds);
      }
      return { ok: outcome.ok, output: outcome.output ?? "" };
    },
    registryHas: (name, version) => {
      const spec = `${name}@${version}`;
      recorder.view(spec);
      if (registry === "error" || (facts.failingViews ?? []).includes(spec)) {
        throw new Error("npm view failed (exit 1) E500");
      }
      return registry.includes(spec);
    },
  };
}

/** Git and GitHub doubles. */
function recordOps(
  facts: World,
  recorder: Recorder,
): Omit<PublishOps, "npmPublish" | "registryHas" | "sha256"> {
  const tags: Record<string, string> = { ...facts.tags };
  return {
    tagCommit: (tag) => tags[tag] ?? null,
    manifestVersionAt: (commit) => facts.commits?.[commit]?.version ?? null,
    createTag: (tag, commit) => {
      recorder.action(`git tag ${tag} ${commit.slice(0, 1)}`);
      tags[tag] = commit;
    },
    pushTag: (tag) => {
      if (facts.failingPush === true) {
        throw new Error("git push failed (exit 128)");
      }
      recorder.action(`git push ${tag}`);
    },
    changelogAt: (commit) => facts.commits?.[commit]?.changelog ?? null,
    releaseExists: (tag) => (facts.releases ?? []).includes(tag),
    createRelease: ({ tag, target, notes }) => {
      const commitish = target === null ? "tag" : `target=${target.slice(0, 1)}`;
      recorder.action(`gh release create ${tag} ${commitish} notes=${JSON.stringify(notes)}`);
    },
    log: () => {
      // The report is asserted through the returned outcomes.
    },
  };
}

/** Command doubles recording every side effect and registry lookup. */
export function world(facts: World): Doubles {
  const actions: string[] = [];
  const views: string[] = [];
  const recorder: Recorder = {
    action: (line) => {
      actions.push(line);
    },
    view: (spec) => {
      views.push(spec);
    },
  };
  return {
    ops: { ...registryOps(facts, recorder), ...recordOps(facts, recorder) },
    actions,
    views,
  };
}

export const record = (name: string, version: string, versionCommit = V1): PublishRecord => ({
  name,
  dir: name.slice(9),
  version,
  versionCommit,
});

export const upload = (name: string, version: string, versionCommit = V1): PublishUpload => ({
  name,
  dir: name.slice(9),
  version,
  versionCommit,
  tarball: `${name.slice(9)}.tgz`,
  sha256: "good",
});

export function outcomeOf(report: PublishReport, name: string): Outcome {
  const outcome = report.outcomes.find((item) => item.name === name);
  assert.ok(outcome, `no outcome for ${name}`);
  return outcome;
}

/** `<name> <upload> <tag>` per package, in visiting order. */
export function summary(report: PublishReport): string[] {
  return report.outcomes.map((outcome) => `${outcome.name} ${outcome.upload} ${outcome.tag}`);
}
