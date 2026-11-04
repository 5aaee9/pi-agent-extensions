import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type BlockedStatusContext,
  formatProgramStatus,
  type ProgramStatusHost,
  RestingStatusTracker,
  reportBlockedQuestion,
  subscribeRestingStatus,
} from "../src/program-status.ts";

const ESC = "\x1b";

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function record(pairs: string): string {
  return `${ESC}]7501;${pairs}${ESC}\\`;
}

function makeHost(overrides: Partial<ProgramStatusHost> = {}) {
  const writes: string[] = [];
  const host: ProgramStatusHost = {
    env: {},
    isTTY: true,
    write: (data) => {
      writes.push(data);
    },
    ...overrides,
  };
  return { host, writes };
}

function makeCtx(idle: boolean, sessionName?: string): BlockedStatusContext {
  return {
    isIdle: () => idle,
    sessionManager: { getSessionName: () => sessionName },
  };
}

type Handler = (event: Record<string, unknown>) => void;

function subscribeTracker() {
  const handlers = new Map<string, Handler>();
  const tracker = new RestingStatusTracker();
  subscribeRestingStatus(
    {
      on: ((name: string, handler: Handler) => {
        handlers.set(name, handler);
        return () => {
          handlers.delete(name);
        };
      }) as never,
    },
    tracker,
  );
  const emit = (name: string, event: Record<string, unknown> = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `missing ${name} handler`);
    handler({ type: name, ...event });
  };
  const assistant = (stopReason: string, errorMessage?: string) =>
    emit("message_end", { message: { role: "assistant", stopReason, errorMessage } });
  return { assistant, emit, tracker };
}

test("program status messages drop control characters and stay within 2048 bytes", () => {
  assert.equal(
    formatProgramStatus({ state: "error", message: "bad\n\u001b[31mthing\t" }),
    record(`state=error:app=pi:msg=${encode("bad [31mthing")}`),
  );
  const long = "é".repeat(1500);
  const sequence = formatProgramStatus({ state: "done", message: long });
  assert.equal(sequence, record(`state=done:app=pi:msg=${encode("é".repeat(1024))}`));
});

test("resting status follows Pi's run results", () => {
  const { assistant, emit, tracker } = subscribeTracker();
  assert.deepEqual(tracker.status, { state: "idle" });

  emit("agent_start");
  assistant("stop");
  emit("agent_settled", { aborted: false });
  assert.deepEqual(tracker.status, { state: "done" });

  emit("agent_start");
  assistant("error", "Rate limited\nretry later");
  emit("agent_settled", { aborted: false });
  assert.deepEqual(tracker.status, { state: "error", message: "Rate limited" });

  emit("agent_start");
  assistant("error");
  assistant("toolUse");
  emit("agent_settled", { aborted: false });
  assert.deepEqual(tracker.status, { state: "done" });

  emit("agent_start");
  assistant("error");
  emit("agent_settled", { aborted: false });
  assert.deepEqual(tracker.status, { state: "error", message: "Error" });
});

test("resting status ignores non-assistant messages and resets on aborts and new sessions", () => {
  const { assistant, emit, tracker } = subscribeTracker();
  emit("agent_start");
  assistant("error", "boom");
  emit("message_end", { message: { role: "user" } });
  emit("agent_settled", { aborted: true });
  assert.deepEqual(tracker.status, { state: "idle" });

  emit("agent_start");
  emit("agent_settled", { aborted: false });
  assert.deepEqual(tracker.status, { state: "done" });
  emit("session_start", { reason: "new" });
  assert.deepEqual(tracker.status, { state: "idle" });
});

test("only a manual compaction outside a run marks the session done", () => {
  const { emit, tracker } = subscribeTracker();
  emit("session_compact", { reason: "threshold" });
  assert.deepEqual(tracker.status, { state: "idle" });

  emit("agent_start");
  emit("session_compact", { reason: "manual" });
  assert.deepEqual(tracker.status, { state: "idle" });
  emit("agent_settled", { aborted: true });

  emit("session_compact", { reason: "manual" });
  assert.deepEqual(tracker.status, { state: "done" });
});

test("fallback restores working with the session name during a run, once", () => {
  const { host, writes } = makeHost({ env: { PI_PROGRAM_STATUS: "1" } });
  const restore = reportBlockedQuestion(
    "Question waiting: Scope",
    makeCtx(false, "refactor"),
    new RestingStatusTracker(),
    host,
  );
  assert.deepEqual(writes, [
    record(`state=blocked:app=pi:kind=question:msg=${encode("Question waiting: Scope")}`),
  ]);
  restore();
  restore();
  assert.deepEqual(writes.slice(1), [record(`state=working:app=pi:msg=${encode("refactor")}`)]);
});

test("fallback restores the tracked resting status when idle", () => {
  const cases: Array<{ expected: string; prepare: (tracker: RestingStatusTracker) => void }> = [
    {
      expected: record(`state=done:app=pi:msg=${encode("refactor")}`),
      prepare: (tracker) => {
        tracker.agentStarted();
        tracker.agentSettled(false);
      },
    },
    {
      expected: record(`state=error:app=pi:msg=${encode("Rate limited")}`),
      prepare: (tracker) => {
        tracker.agentStarted();
        tracker.assistantMessageEnded("error", "Rate limited");
        tracker.agentSettled(false);
      },
    },
    {
      expected: record("state=idle:app=pi"),
      prepare: () => {
        // A fresh session has not run yet.
      },
    },
  ];
  for (const { expected, prepare } of cases) {
    const tracker = new RestingStatusTracker();
    prepare(tracker);
    const { host, writes } = makeHost();
    reportBlockedQuestion("Question waiting", makeCtx(true, "refactor"), tracker, host)();
    assert.equal(writes[1], expected);
  }
});
