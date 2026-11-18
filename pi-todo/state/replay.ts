import { Value } from "typebox/value";
import { STATE_ENTRY_TYPE, TOOL_NAME, TodoParamsSchema } from "../tool/types.ts";
import { applyTaskMutation } from "./state-reducer.ts";
import { EMPTY_STATE, type TaskState } from "./state.ts";
import type {
  Task,
  TaskAction,
  TaskMutationParams,
  TaskStatus,
  CompactTaskDetails,
} from "../tool/types.ts";

const TASK_ACTIONS: ReadonlySet<string> = new Set<TaskAction>([
  "create",
  "update",
  "list",
  "get",
  "delete",
  "clear",
]);
const TASK_STATUSES: ReadonlySet<unknown> = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "completed",
  "deleted",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTaskAction = (value: unknown): value is TaskAction =>
  typeof value === "string" && TASK_ACTIONS.has(value);

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.id) &&
    typeof value.subject === "string" &&
    TASK_STATUSES.has(value.status) &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.activeForm === undefined || typeof value.activeForm === "string") &&
    (value.owner === undefined || typeof value.owner === "string") &&
    (value.blockedBy === undefined ||
      (Array.isArray(value.blockedBy) && value.blockedBy.every(Number.isSafeInteger))) &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

/**
 * Discriminator for legacy details envelopes with a complete task snapshot.
 * A malformed or partial snapshot is skipped so replay keeps the last valid
 * state instead of replacing it with corrupt data.
 */
function isLegacySnapshot(value: unknown): value is TaskState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.tasks) && value.tasks.every(isTask) && Number.isSafeInteger(value.nextId)
  );
}

/** Discriminator for the compact action-and-parameters persistence record. */
function isCompactTaskDetails(value: unknown): value is CompactTaskDetails {
  if (!isRecord(value)) return false;
  return (
    isTaskAction(value.action) &&
    isRecord(value.params) &&
    !Object.hasOwn(value, "tasks") &&
    !Object.hasOwn(value, "nextId") &&
    value.error === undefined &&
    Value.Check(TodoParamsSchema, { ...value.params, action: value.action })
  );
}

/** Fresh `TaskState` from a legacy persisted snapshot. */
function stateOf(details: TaskState): TaskState {
  return { tasks: details.tasks.map((task) => ({ ...task })), nextId: details.nextId };
}

function applyRecords(records: unknown[], base: TaskState): TaskState {
  // A full snapshot supersedes every earlier operation in this stream.
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (!isLegacySnapshot(record)) continue;
    base = stateOf(record);
    records = records.slice(i + 1);
    break;
  }
  for (const record of records) {
    if (isCompactTaskDetails(record)) {
      base = applyTaskMutation(base, record.action, record.params as TaskMutationParams).state;
    }
  }
  return base;
}

/**
 * Walk the current branch in chronological order and reconstruct task state.
 *
 * New records contain only the action and parameters needed to replay the
 * operation. Legacy records contain the full `tasks`/`nextId` snapshot. Custom
 * entries remain authoritative when present because a nested tool call may not
 * have a standalone toolResult message. Tool results preceding the first valid
 * custom entry can seed old branches, but later results duplicate the custom stream.
 */
export function replayFromBranch(ctx: {
  sessionManager: { getBranch(): Iterable<unknown> };
}): TaskState {
  const customRecords: unknown[] = [];
  const toolResultRecords: unknown[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    const value = entry as {
      type?: string;
      customType?: string;
      data?: unknown;
      message?: { role?: string; toolName?: string; details?: unknown };
    };

    if (value.type === "custom") {
      if (
        value.customType === STATE_ENTRY_TYPE &&
        (customRecords.length > 0 ||
          isCompactTaskDetails(value.data) ||
          isLegacySnapshot(value.data))
      ) {
        customRecords.push(value.data);
      }
      continue;
    }

    if (customRecords.length > 0 || value.type !== "message") continue;
    const message = value.message;
    if (message?.role === "toolResult" && message.toolName === TOOL_NAME) {
      toolResultRecords.push(message.details);
    }
  }

  const empty = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
  const first = customRecords[0];
  const base = isLegacySnapshot(first) ? empty : applyRecords(toolResultRecords, empty);
  return applyRecords(customRecords, base);
}
