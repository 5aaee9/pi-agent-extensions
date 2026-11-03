import assert from "node:assert/strict";
import { test } from "vitest";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { createQuestionWaitingNotification, notifyQuestionWaiting } from "../src/notifications.ts";

test("notification payload uses question label before prompt", () => {
  const payload = createQuestionWaitingNotification({
    label: "Scope",
    prompt: "What should we change?",
  });

  assert.deepEqual(payload, {
    event: "question.waiting",
    title: "pi ask",
    message: "Question waiting: Scope",
  });
});

test("notification payload falls back to prompt and compacts whitespace", () => {
  const payload = createQuestionWaitingNotification({
    label: "",
    prompt: "What\nshould\twe change?",
  });

  assert.equal(payload.message, "Question waiting: What should we change?");
});

test("disabled notifications are skipped", async () => {
  const attempts = await notifyQuestionWaiting(
    {
      ...DEFAULT_ASK_CONFIG,
      notifications: { channels: ["bell"], enabled: false },
    },
    createQuestionWaitingNotification({ label: "Scope", prompt: "Prompt" }),
  );

  assert.deepEqual(attempts, [{ channel: "notifications", status: "skipped" }]);
});

test("new configurations enable bell and OSC 7501", () => {
  assert.deepEqual(DEFAULT_ASK_CONFIG.notifications.channels, ["bell", "osc7501"]);
});

test("terminal notifications do not write escape sequences to redirected stdout", async () => {
  assert.equal(Boolean(process.stdout.isTTY), false);
  const attempts = await notifyQuestionWaiting(
    DEFAULT_ASK_CONFIG,
    createQuestionWaitingNotification({ label: "Scope", prompt: "Prompt" }),
  );
  assert.deepEqual(attempts, [
    { channel: "bell", status: "skipped" },
    { channel: "osc7501", status: "skipped" },
  ]);
});

test("command notification receives env and swallows failures", async () => {
  const payload = createQuestionWaitingNotification({
    label: "Scope",
    prompt: "Prompt",
  });
  const attempts = await notifyQuestionWaiting(
    {
      ...DEFAULT_ASK_CONFIG,
      notifications: {
        channels: [
          {
            command:
              "node -e 'if (process.env.ASK_NOTIFY_MESSAGE !== \"Question waiting: Scope\") process.exit(7)'",
            type: "command",
          },
          { command: "node -e 'process.exit(3)'", type: "command" },
        ],
        enabled: true,
      },
    },
    payload,
  );

  assert.equal(attempts[0]?.status, "attempted");
  assert.equal(attempts[1]?.status, "failed");
});
