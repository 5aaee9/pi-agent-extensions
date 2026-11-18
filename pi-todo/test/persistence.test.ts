import { describe, expect, it } from "vitest";

import { applyTaskMutation } from "../state/state-reducer.ts";
import { EMPTY_STATE } from "../state/state.ts";
import { buildToolResult } from "../tool/response-envelope.ts";
import type { TaskAction, TaskMutationParams } from "../tool/types.ts";

function buildDetails(action: TaskAction, params: TaskMutationParams) {
  const result = applyTaskMutation(EMPTY_STATE, action, params);
  return buildToolResult(action, params, result.state, result.op).details;
}

describe("compact todo persistence details", () => {
  it("keeps the complete state in memory but omits it from JSON", () => {
    const params = { action: "create", subject: "Write tests" } as TaskMutationParams;
    const details = buildDetails("create", params);

    expect(details.tasks).toEqual([{ id: 1, subject: "Write tests", status: "pending" }]);
    expect(details.nextId).toBe(2);
    expect(Object.keys(details)).toEqual(["action", "params"]);
    expect(JSON.parse(JSON.stringify(details))).toEqual({ action: "create", params });
  });

  it.each([
    ["list", { action: "list" }],
    ["get error", { action: "get", id: 9 }],
    ["invalid update", { action: "update", id: 9, status: "completed" }],
  ] as const)("does not serialize a snapshot for %s", (_label, params) => {
    const action = params.action as TaskAction;
    const details = buildDetails(action, params as TaskMutationParams);
    const serialized = JSON.parse(JSON.stringify(details)) as Record<string, unknown>;

    expect(serialized).toMatchObject({ action, params });
    expect(serialized).not.toHaveProperty("tasks");
    expect(serialized).not.toHaveProperty("nextId");
  });
});
