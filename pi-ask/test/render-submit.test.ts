import assert from "node:assert/strict";
import { test } from "vitest";
import { UI_DIMENSIONS } from "../src/constants/ui.ts";
import { createInitialState } from "../src/state/create.ts";
import {
  applyNumberShortcut,
  enterOptionNoteMode,
  enterQuestionNoteMode,
  saveNote,
} from "../src/state/transitions.ts";
import { renderSubmitScreen } from "../src/ui/render-submit.ts";

function plainTheme() {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  } as never;
}

test("submit screen shows notes only for answered questions in submit mode", () => {
  let state = createInitialState({
    questions: [
      {
        id: "q1",
        label: "Single",
        prompt: "Pick one primary demo style.",
        options: [{ value: "code", label: "Code demo" }],
      },
      {
        id: "q2",
        label: "Multi",
        prompt: "Pick any extra things to include.",
        options: [{ value: "extra", label: "Extra" }],
      },
    ],
  });

  state = enterQuestionNoteMode(state, "q1");
  state = saveNote(state, "Question note");
  state = applyNumberShortcut(state, 1);
  state = enterOptionNoteMode(state, "q1", "code");
  state = saveNote(state, "Option note");
  state = enterQuestionNoteMode(state, "q2");
  state = saveNote(state, "Second note");

  const lines: string[] = [];
  renderSubmitScreen(lines, state, plainTheme(), UI_DIMENSIONS.submitWideMinWidth + 76);

  const firstQuestionIndex = lines.findIndex((line) => line.includes("Single"));
  const firstQuestionNoteIndex = lines.findIndex((line) => line.includes("Question note"));
  const firstAnswerIndex = lines.findIndex((line) => line.includes("→ Code demo"));
  const optionNoteIndex = lines.findIndex((line) => line.includes("Option note"));
  const secondQuestionIndex = lines.findIndex((line) => line.includes("Multi"));

  assert.notEqual(firstQuestionIndex, -1);
  assert.notEqual(firstQuestionNoteIndex, -1);
  assert.notEqual(firstAnswerIndex, -1);
  assert.notEqual(optionNoteIndex, -1);
  assert.notEqual(secondQuestionIndex, -1);
  assert(firstQuestionNoteIndex < firstAnswerIndex);
  assert(optionNoteIndex > firstAnswerIndex);
  assert(lines[firstQuestionNoteIndex]?.startsWith("     "));
  assert(lines[optionNoteIndex]?.startsWith("     "));
  assert.equal(lines[secondQuestionIndex - 1]?.trim(), "");
  assert(lines.some((line) => line.includes("Note:")));
  assert(!lines.some((line) => line.includes("Second note")));
  assert(!lines.some((line) => line.includes("Question note:")));
  assert(!lines.some((line) => line.includes("Code demo note:")));
  assert(!lines.some((line) => line.includes("Pick one primary demo style.")));
  assert(!lines.some((line) => line.includes("Pick any extra things to include.")));
});

test("submit screen shows all notes when elaborate action is selected", () => {
  let state = createInitialState({
    questions: [
      {
        id: "q1",
        label: "Single",
        prompt: "Pick one primary demo style.",
        options: [
          { value: "code", label: "Code demo" },
          { value: "slides", label: "Slides demo" },
        ],
      },
      {
        id: "q2",
        label: "Multi",
        prompt: "Pick any extra things to include.",
        options: [{ value: "extra", label: "Extra" }],
      },
    ],
  });

  state = enterQuestionNoteMode(state, "q1");
  state = saveNote(state, "Question note");
  state = applyNumberShortcut(state, 1);
  state = enterOptionNoteMode(state, "q1", "code");
  state = saveNote(state, "Selected option note");
  state = enterOptionNoteMode(state, "q1", "slides");
  state = saveNote(state, "Unselected option note");
  state = enterQuestionNoteMode(state, "q2");
  state = saveNote(state, "Second note");
  state = { ...state, activeSubmitActionIndex: 1 };

  const lines: string[] = [];
  renderSubmitScreen(lines, state, plainTheme(), UI_DIMENSIONS.submitWideMinWidth + 16);

  assert(lines.some((line) => line.includes("Question note")));
  assert(lines.some((line) => line.includes("Selected option note")));
  assert(lines.some((line) => line.includes("Unselected option note")));
  assert(lines.some((line) => line.includes("Slides demo Note:")));
  assert(lines.some((line) => line.includes("Second note")));
});
