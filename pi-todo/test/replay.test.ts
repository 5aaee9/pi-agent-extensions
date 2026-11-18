import { describe, expect, it } from "vitest";

import { replayFromBranch } from "../state/replay.ts";
import { applyTaskMutation } from "../state/state-reducer.ts";
import { EMPTY_STATE, type TaskState } from "../state/state.ts";
import { buildToolResult } from "../tool/response-envelope.ts";
import type { TaskAction, TaskMutationParams } from "../tool/types.ts";

type BranchEntry = {
  type: "custom" | "message";
  customType?: string;
  data?: unknown;
  message?: { role: "toolResult"; toolName: "todo"; details: unknown };
};

function session(branch: Iterable<BranchEntry>) {
  return { sessionManager: { getBranch: () => branch } };
}

function compactDetails(
  state: TaskState,
  action: TaskAction,
  params: TaskMutationParams,
): { details: unknown; state: TaskState } {
  const result = applyTaskMutation(state, action, params);
  const details = buildToolResult(action, params, result.state, result.op).details;
  return { details: JSON.parse(JSON.stringify(details)), state: result.state };
}

function toolResult(details: unknown): BranchEntry {
  return { type: "message", message: { role: "toolResult", toolName: "todo", details } };
}

function custom(details: unknown): BranchEntry {
  return { type: "custom", customType: "rpiv-todo-state", data: details };
}

describe("todo branch replay", () => {
  it("replays a compact operation sequence from tool results", () => {
    const createParams = { action: "create", subject: "Write tests" } as TaskMutationParams;
    const created = compactDetails(EMPTY_STATE, "create", createParams);
    const updateParams = { action: "update", id: 1, status: "in_progress" } as TaskMutationParams;
    const updated = compactDetails(created.state, "update", updateParams);

    const state = replayFromBranch(
      session([toolResult(created.details), toolResult(updated.details)]),
    );

    expect(state).toEqual(updated.state);
  });

  it("uses the custom stream once when a direct call has both records", () => {
    const params = { action: "create", subject: "Only once" } as TaskMutationParams;
    const record = compactDetails(EMPTY_STATE, "create", params).details;

    const state = replayFromBranch(session([custom(record), toolResult(record)]));

    expect(state.tasks).toEqual([{ id: 1, subject: "Only once", status: "pending" }]);
    expect(state.nextId).toBe(2);
  });

  it("replays a nested-only custom mutation", () => {
    const params = { action: "create", subject: "Nested call" } as TaskMutationParams;
    const record = compactDetails(EMPTY_STATE, "create", params).details;

    const state = replayFromBranch(session([custom(record)]));

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.subject).toBe("Nested call");
  });

  it("replays legacy snapshots and then compact operations", () => {
    const legacy = {
      action: "create",
      params: { action: "create", subject: "Legacy task" },
      tasks: [{ id: 1, subject: "Legacy task", status: "pending" as const }],
      nextId: 2,
    };
    const updateParams = { action: "update", id: 1, status: "completed" } as TaskMutationParams;
    const updated = compactDetails(
      { tasks: legacy.tasks, nextId: legacy.nextId },
      "update",
      updateParams,
    ).details;

    const state = replayFromBranch(session([custom(legacy), custom(updated)]));

    expect(state.tasks[0]).toMatchObject({ id: 1, subject: "Legacy task", status: "completed" });
    expect(state.nextId).toBe(2);
  });

  it("skips malformed records and retains valid state", () => {
    const createParams = { action: "create", subject: "Keep me" } as TaskMutationParams;
    const created = compactDetails(EMPTY_STATE, "create", createParams);
    const updateParams = { action: "update", id: 1, status: "completed" } as TaskMutationParams;
    const updated = compactDetails(created.state, "update", updateParams);

    const state = replayFromBranch(
      session([
        custom(created.details),
        custom({ action: "unknown", params: {}, tasks: "not-a-snapshot" }),
        custom({ action: "create", params: { action: "create", subject: 42 } }),
        custom(updated.details),
      ]),
    );

    expect(state.tasks[0]).toMatchObject({ id: 1, status: "completed" });
  });

  it("starts compact custom replay from a legacy tool-result-only branch", () => {
    const legacy: TaskState = {
      tasks: [{ id: 1, subject: "From an older Pi session", status: "pending" }],
      nextId: 2,
    };
    const { details, state } = compactDetails(legacy, "update", {
      action: "update",
      id: 1,
      status: "completed",
    });
    expect(
      replayFromBranch(session([toolResult(legacy), custom(details), toolResult(details)])),
    ).toEqual(state);
  });

  it("replays delete and clear through the same mutation rules", () => {
    const createParams = { action: "create", subject: "Delete me" } as TaskMutationParams;
    const created = compactDetails(EMPTY_STATE, "create", createParams);
    const deleteParams = { action: "delete", id: 1 } as TaskMutationParams;
    const deleted = compactDetails(created.state, "delete", deleteParams);
    const clearParams = { action: "clear" } as TaskMutationParams;
    const cleared = compactDetails(deleted.state, "clear", clearParams);

    const state = replayFromBranch(
      session([custom(created.details), custom(deleted.details), custom(cleared.details)]),
    );

    expect(state).toEqual({ tasks: [], nextId: 1 });
  });
});
