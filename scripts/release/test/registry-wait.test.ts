import assert from "node:assert/strict";
import { test } from "node:test";

import { createWaitBudget, waitUntilVisible, type WaitOps } from "../registry-wait.ts";

const BUDGET = 30 * 60_000;
const SKILL = "@indexyz/pi-skill";
const VERSION = "0.1.44";

const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

/** A wait whose registry never serves the version, on a virtual clock. */
function neverVisible(): { readonly ops: WaitOps; readonly waits: number[] } {
  let now = 0;
  const waits: number[] = [];
  return {
    ops: {
      registryHas: () => false,
      now: () => now,
      sleep: (ms) => {
        waits.push(ms);
        now += ms;
      },
      log: () => {},
    },
    waits,
  };
}

void test("the budget counts down from its first question and never resets", () => {
  let now = 0;
  const budget = createWaitBudget(() => now);
  assert.equal(budget.remaining(), BUDGET);
  now += 60_000;
  assert.equal(budget.remaining(), BUDGET - 60_000);
  now += 120_000;
  assert.equal(budget.remaining(), BUDGET - 180_000);
});

void test("the deadline starts at the first wait, not when the budget is made", () => {
  let now = 0;
  const budget = createWaitBudget(() => now);
  now += 10 * 60_000;
  assert.equal(budget.remaining(), BUDGET, "a slow upload does not eat the wait budget");
});

void test("a clock that jumps forward ends the budget instead of extending it", () => {
  let now = 0;
  const budget = createWaitBudget(() => now);
  assert.equal(budget.remaining(), BUDGET);
  now += BUDGET + 1;
  assert.ok(budget.remaining() <= 0);
});

void test("a version that never appears is waited for exactly the budget, never more", () => {
  const { ops, waits } = neverVisible();
  const visible = waitUntilVisible(
    SKILL,
    VERSION,
    ops,
    createWaitBudget(() => ops.now()),
  );
  assert.equal(visible, false);
  assert.equal(total(waits), BUDGET);
  assert.equal(Math.max(...waits), 120_000, "the interval never exceeds the cap");
});

void test("a version that appears during the last clamped wait is still visible", () => {
  let now = 0;
  const waits: number[] = [];
  const ops: WaitOps = {
    registryHas: () => now >= BUDGET,
    now: () => now,
    sleep: (ms) => {
      waits.push(ms);
      now += ms;
    },
    log: () => {},
  };
  assert.equal(
    waitUntilVisible(
      SKILL,
      VERSION,
      ops,
      createWaitBudget(() => ops.now()),
    ),
    true,
  );
  assert.equal(total(waits), BUDGET, "the last wait is clamped to what is left");
});
