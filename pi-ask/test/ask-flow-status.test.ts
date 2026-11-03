import assert from "node:assert/strict";
import { test } from "vitest";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import type { AskResult } from "../src/types.ts";
import { runAskFlow } from "../src/ui/controller.ts";

test("the ask form asks Pi to report a blocked question while it is open", async () => {
  getAskConfigStore().setConfig({
    ...DEFAULT_ASK_CONFIG,
    notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
  });
  const calls: unknown[] = [];
  const cancelled = { cancelled: true } as AskResult;
  const result = await runAskFlow(
    {
      cwd: process.cwd(),
      mode: "tui",
      ui: {
        custom(_factory: unknown, options: unknown) {
          calls.push(options);
          return Promise.resolve(cancelled);
        },
      },
    } as never,
    {
      questions: [
        {
          id: "scope",
          label: "Scope",
          prompt: "Which packages?",
          options: [{ value: "all", label: "All" }],
        },
        {
          id: "tone",
          prompt: "Which tone?",
          options: [{ value: "plain", label: "Plain" }],
        },
      ],
    },
  );

  assert.equal(result, cancelled);
  assert.deepEqual(calls, [{ blocked: { kind: "question", message: "Question waiting: Scope" } }]);
  getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
});
