import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyRemoteAskResponse,
  createRemoteAskRuntime,
  PI_ASK_STARTED_EVENT,
  type RemoteAskStartedEvent,
} from "../src/remote-ask.ts";
import { createInitialState } from "../src/state/create.ts";

const UNKNOWN_APPROVE_VALUE_RE = /Unknown option value "approve"/;

class TestEventBus {
  readonly events: Array<{ channel: string; data: unknown }> = [];
  private readonly handlers = new Map<string, Array<(data: unknown) => void>>();

  emit(channel: string, data: unknown): void {
    this.events.push({ channel, data });
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(data);
    }
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const handlers = this.handlers.get(channel) ?? [];
    handlers.push(handler);
    this.handlers.set(channel, handlers);
    return () => {
      this.handlers.set(
        channel,
        (this.handlers.get(channel) ?? []).filter((candidate) => candidate !== handler),
      );
    };
  }
}

test("remote answer response validates and serializes explicit option values", () => {
  const state = createInitialState({
    questions: [
      {
        id: "decision",
        prompt: "Proceed?",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    ],
  });

  const result = applyRemoteAskResponse(state, {
    kind: "answer",
    answers: {
      decision: { values: ["yes"], note: "ship it" },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.completed, true);
  assert.deepEqual(result.state.answers.decision, {
    selected: [{ value: "yes", label: "Yes", index: 1 }],
    note: "ship it",
    customSelected: undefined,
    customText: undefined,
    optionNotes: undefined,
  });
});

test("remote answer response replaces stale UI answers", () => {
  const state = createInitialState({
    questions: [
      {
        id: "decision",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes" }],
      },
      {
        id: "stale",
        prompt: "Old answer?",
        options: [{ value: "old", label: "Old" }],
      },
    ],
  });
  state.answers.stale = {
    selected: [{ value: "old", label: "Old", index: 1 }],
  };

  const result = applyRemoteAskResponse(state, {
    kind: "answer",
    answers: { decision: { values: ["yes"] } },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.state.answers), ["decision"]);
});

test("remote answer response rejects guessed or unknown option values", () => {
  const state = createInitialState({
    questions: [
      {
        id: "decision",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes" }],
      },
    ],
  });

  const result = applyRemoteAskResponse(state, {
    kind: "answer",
    answers: { decision: { values: ["approve"] } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_answer");
  assert.match(result.message, UNKNOWN_APPROVE_VALUE_RE);
  assert.equal(result.state.completed, false);
});

test("started event questions are cloned", async () => {
  const bus = new TestEventBus();
  const remoteAsk = createRemoteAskRuntime(bus as never);
  const questions = createInitialState({
    questions: [
      {
        id: "decision",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes", recommended: true }],
      },
    ],
  }).questions;

  remoteAsk.startFlow({
    source: "tool",
    questions,
    onSubmit: () => ({ ok: true }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const started = bus.events.find((event) => event.channel === PI_ASK_STARTED_EVENT)
    ?.data as RemoteAskStartedEvent;
  assert.equal(started.questions[0].options[0].recommended, true);
  started.questions[0].options[0].label = "Mutated";
  started.questions[0].options[0].recommended = false;

  assert.equal(questions[0].options[0].label, "Yes");
  assert.equal(questions[0].options[0].recommended, true);
});
