import { describe, expect, it } from "vitest";

import { programStatusRecords, startAskTui } from "./tui-plane.ts";

const payload = {
  questions: [
    {
      id: "scope",
      label: "Scope",
      prompt: "PTY_COMPAT_QUESTION: Which packages?",
      options: [
        { value: "all", label: "All packages" },
        { value: "changed", label: "Changed packages" },
      ],
    },
  ],
};

describe.each([
  { legacy: false, host: "Pi 1.5 native program status" },
  { legacy: true, host: "Pi 1.4 fallback program status" },
])("$host", ({ legacy }) => {
  it("reports one blocked root record across redraws and restores status on Escape", async () => {
    const host = await startAskTui({ legacy, statusEnabled: true }, payload);
    try {
      await host.waitFor(
        (text) =>
          text.includes("PTY_COMPAT_QUESTION") &&
          programStatusRecords(text).some(({ state }) => state === "blocked"),
        "the rendered question and blocked status",
      );
      const blocked = host.statuses().filter(({ state }) => state === "blocked");
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatchObject({
        app: "pi",
        kind: "question",
        message: "Question waiting: Scope",
      });
      expect(blocked[0]!.fields.id).toBeUndefined();
      expect(blocked[0]!.fields.parent).toBeUndefined();

      const beforeResize = host.output().length;
      host.terminal.resize(72, 28);
      await host.waitFor(
        (text) => text.slice(beforeResize).includes("PTY_COMPAT_QUESTION"),
        "the resized question",
      );
      expect(host.statuses().filter(({ state }) => state === "blocked")).toHaveLength(1);
      host.terminal.write("\x1b");
      await host.waitFor(
        (text) =>
          text.includes("ASK_HOST_FINISHED") && programStatusRecords(text).at(-1)?.state === "done",
        "the completed response and restored status",
      );

      const statuses = host.statuses();
      const blockedIndex = statuses.findIndex(({ state }) => state === "blocked");
      expect(statuses.filter(({ state }) => state === "blocked")).toHaveLength(1);
      expect(statuses[blockedIndex + 1]).toMatchObject({ state: "working", app: "pi" });
      expect(statuses.at(-1)).toMatchObject({ state: "done", app: "pi" });
      const toolResult = (await host.plane.entries())
        .map(({ message }) => message)
        .find(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            "role" in message &&
            message.role === "toolResult",
        );
      expect(toolResult).toMatchObject({
        toolName: "ask_user_question",
        isError: false,
        details: { cancelled: true },
      });
    } finally {
      await host.close();
    }
  }, 45_000);

  it("honors PI_PROGRAM_STATUS=0 throughout the real question interaction", async () => {
    const host = await startAskTui({ legacy, statusEnabled: false }, payload);
    try {
      await host.waitFor((text) => text.includes("PTY_COMPAT_QUESTION"), "the rendered question");
      expect(host.statuses()).toEqual([]);
      host.terminal.write("\x1b");
      await host.waitFor(
        (text) => text.includes("ASK_HOST_FINISHED"),
        "the response after cancelling the question",
      );
      expect(host.statuses()).toEqual([]);
    } finally {
      await host.close();
    }
  }, 45_000);
});
