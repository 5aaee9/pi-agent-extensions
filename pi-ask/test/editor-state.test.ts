import assert from "node:assert/strict";
import { test } from "vitest";
import { createInitialState } from "../src/state/create.ts";
import {
  getEditorDraft,
  saveEditorDraft,
  submitEditorDraft,
  syncStateToSelection,
} from "../src/state/editor.ts";
import { enterQuestionNoteMode } from "../src/state/transitions.ts";

test("submitted answer can sync directly into next freeform input", () => {
  let state = syncStateToSelection(
    createInitialState(
      {
        questions: [
          {
            id: "q1",
            prompt: "First?",
            options: [{ value: "freeform", label: "Type answer", freeform: true }],
          },
          {
            id: "q2",
            prompt: "Second?",
            options: [{ value: "freeform", label: "Type answer", freeform: true }],
          },
        ],
      },
      { allowFreeform: true },
    ),
  );

  state = submitEditorDraft(state, "first answer");
  state = syncStateToSelection(state);

  assert.equal(state.activeTabIndex, 1);
  assert.deepEqual(state.view, { kind: "input", questionId: "q2" });
});

test("syncStateToSelection does not reopen answered freeform input", () => {
  let state = syncStateToSelection(
    createInitialState(
      {
        questions: [
          {
            id: "q1",
            prompt: "First?",
            options: [{ value: "freeform", label: "Type answer", freeform: true }],
          },
        ],
      },
      { allowFreeform: true },
    ),
  );
  state = submitEditorDraft(state, "already answered");
  state = syncStateToSelection({
    ...state,
    activeTabIndex: 0,
    view: { kind: "navigate" },
  });

  assert.equal(state.view.kind, "navigate");
  assert.equal(state.answers.q1.customText, "already answered");
});

test("submitEditorDraft saves notes without completing the ask flow", () => {
  const state = enterQuestionNoteMode(
    createInitialState({
      questions: [
        {
          id: "q1",
          prompt: "Question?",
          options: [{ value: "a", label: "A" }],
        },
      ],
    }),
    "q1",
  );

  const next = submitEditorDraft(state, "needs examples");
  assert.equal(next.answers.q1.note, "needs examples");
  assert.equal(next.view.kind, "navigate");
  assert.equal(next.completed, false);
  assert.equal(next.cancelled, false);
});

test("getEditorDraft reads saved note and custom text from view", () => {
  let state = syncStateToSelection({
    ...createInitialState({
      questions: [
        {
          id: "q1",
          prompt: "Pick one",
          options: [{ value: "a", label: "A" }],
        },
      ],
    }),
    activeOptionIndex: 1,
  });
  state = saveEditorDraft(state, "draft answer");
  state = enterQuestionNoteMode(state, "q1");
  state = saveEditorDraft(state, "saved note");
  state = enterQuestionNoteMode(state, "q1");

  assert.equal(getEditorDraft(state), "saved note");
  assert.equal(
    getEditorDraft({ ...state, view: { kind: "input", questionId: "q1" } }),
    "draft answer",
  );
});
