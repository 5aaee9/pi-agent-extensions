// The publish step's wait for npm registry propagation: `npm publish` can
// accept a tarball before the registry serves the version, so a version this
// run uploaded is re-checked on an exponential backoff instead of failing.

/** How long the whole run may spend waiting for uploaded versions to appear. */
const WAIT_BUDGET_MS = 30 * 60_000;
/** The first interval between registry lookups while waiting. */
const WAIT_FIRST_MS = 5_000;
/** The longest interval between registry lookups while waiting. */
const WAIT_MAX_MS = 120_000;

/** The wait budget as the messages an operator reads name it. */
export const WAIT_BUDGET_MINUTES = WAIT_BUDGET_MS / 60_000;

/** What the wait needs from the publish step. */
export interface WaitOps {
  readonly registryHas: (name: string, version: string) => boolean;
  /**
   * Monotonic elapsed milliseconds. The budget is a hard ceiling, so this must
   * never be a wall clock that a time correction can move backwards; the real
   * adapter uses `performance.now()`.
   */
  readonly now: () => number;
  readonly sleep: (ms: number) => void;
  readonly log: (line: string) => void;
}

/**
 * The run-wide budget for waiting on registry propagation. `remaining` reports
 * what is left and establishes the deadline when it is first asked, so the whole
 * run never waits longer than `WAIT_BUDGET_MS`, however many versions it waits
 * for.
 */
export interface WaitBudget {
  readonly remaining: () => number;
}

/** A budget whose deadline starts at the first question asked of it. */
export function createWaitBudget(now: () => number): WaitBudget {
  let deadline: number | null = null;
  return {
    remaining: () => {
      const start = deadline ?? now() + WAIT_BUDGET_MS;
      deadline = start;
      return start - now();
    },
  };
}

/**
 * Whether `<name>@<version>` is visible, waiting out registry propagation: an
 * unconfirmed lookup is retried on an exponential backoff (5 s, 10 s, then
 * doubled up to 2 minutes) until the run's budget runs out. A lookup that errors
 * is not absence, so it is left to throw.
 */
export function waitUntilVisible(
  name: string,
  version: string,
  ops: WaitOps,
  budget: WaitBudget,
): boolean {
  const label = `${name}@${version}`;
  if (ops.registryHas(name, version)) {
    return true;
  }
  let interval = WAIT_FIRST_MS;
  let remaining = budget.remaining();
  while (remaining > 0) {
    // Never sleep past the deadline: the last lookup decides at it.
    const wait = Math.min(interval, remaining);
    ops.log(`${label} is not on the registry yet; checking again in ${Math.round(wait / 1000)}s`);
    ops.sleep(wait);
    if (ops.registryHas(name, version)) {
      return true;
    }
    interval = Math.min(interval * 2, WAIT_MAX_MS);
    remaining = budget.remaining();
  }
  return false;
}
