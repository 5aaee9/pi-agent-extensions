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
  /**
   * A version the registry serves for this upload — because npm accepted it, or
   * because npm refused it as already published. Absent means the registry
   * never serves the version this upload names.
   */
  readonly adds?: string;
  /** Registry propagation: milliseconds before `adds` starts being served. */
  readonly visibleAfter?: number;
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

/** The virtual clock the wait budget is measured against. */
interface Clock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
}

/** Collects what the doubles observe. */
interface Recorder {
  readonly action: (line: string) => void;
  readonly view: (spec: string) => void;
  readonly wait: (ms: number) => void;
}

export interface Doubles {
  readonly ops: PublishOps;
  /** Side effects, in order. */
  readonly actions: readonly string[];
  /** Registry lookups, in order. */
  readonly views: readonly string[];
  /** Every waited duration, in order; their sum is the run's total waiting. */
  readonly waits: readonly number[];
}

/** A clock the wait can advance without spending real time. */
function virtualClock(): Clock {
  let elapsed = 0;
  return {
    now: () => elapsed,
    advance: (ms) => {
      elapsed += ms;
    },
  };
}

/** The clock and the sleep the wait budget runs on. */
function timeOps(clock: Clock, recorder: Recorder): Pick<PublishOps, "now" | "sleep"> {
  return {
    now: () => clock.now(),
    sleep: (ms) => {
      recorder.wait(ms);
      clock.advance(ms);
    },
  };
}

/** Registry doubles: uploads may add versions; lookups may fail. */
function registryOps(
  facts: World,
  recorder: Recorder,
  clock: Clock,
): Pick<PublishOps, "npmPublish" | "registryHas" | "sha256"> {
  const registry = facts.registry === "error" ? "error" : [...(facts.registry ?? [])];
  /** Versions the registry does not serve before `at`, in milliseconds. */
  const propagating: { readonly spec: string; readonly at: number }[] = [];
  return {
    sha256: (tarball) => facts.hashes?.[tarball] ?? "good",
    npmPublish: (tarball): PublishResult => {
      recorder.action(`npm publish ${tarball}`);
      const outcome: UploadBehaviour = facts.publish?.[tarball] ?? { ok: true };
      const added = outcome.adds;
      if (added !== undefined && registry !== "error") {
        const propagation = outcome.visibleAfter ?? 0;
        if (propagation === 0) {
          registry.push(added);
        } else {
          propagating.push({ spec: added, at: clock.now() + propagation });
        }
      }
      return { ok: outcome.ok, output: outcome.output ?? "" };
    },
    registryHas: (name, version) => {
      const spec = `${name}@${version}`;
      recorder.view(spec);
      if (registry === "error" || (facts.failingViews ?? []).includes(spec)) {
        throw new Error("npm view failed (exit 1) E500");
      }
      return (
        registry.includes(spec) ||
        propagating.some((entry) => entry.spec === spec && clock.now() >= entry.at)
      );
    },
  };
}

/** Git and GitHub doubles. */
function recordOps(
  facts: World,
  recorder: Recorder,
): Omit<PublishOps, "npmPublish" | "registryHas" | "sha256" | "now" | "sleep"> {
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

/** Command doubles recording every side effect, registry lookup, and wait. */
export function world(facts: World): Doubles {
  const actions: string[] = [];
  const views: string[] = [];
  const waits: number[] = [];
  const clock = virtualClock();
  const recorder: Recorder = {
    action: (line) => {
      actions.push(line);
    },
    view: (spec) => {
      views.push(spec);
    },
    wait: (ms) => {
      waits.push(ms);
    },
  };
  return {
    ops: {
      ...timeOps(clock, recorder),
      ...registryOps(facts, recorder, clock),
      ...recordOps(facts, recorder),
    },
    actions,
    views,
    waits,
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
