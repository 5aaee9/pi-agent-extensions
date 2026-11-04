import assert from "node:assert/strict";
import { test } from "vitest";
import {
  extractionCandidateFromContent,
  parseExtractionCandidate,
  repairExtractionParams,
} from "../src/answer-extraction.ts";

test("repairExtractionParams caps options while preserving other", () => {
  const repaired = repairExtractionParams({
    questions: [
      {
        id: "q",
        prompt: "Pick one",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
          { value: "d", label: "D" },
          { value: "other", label: "Other" },
        ],
      },
    ],
  });

  assert.deepEqual(
    repaired.questions[0]?.options.map((option) => option.value),
    ["a", "b", "c", "other"],
  );
});

test("repairExtractionParams drops generic conversational prompts", () => {
  const repaired = repairExtractionParams({
    questions: [
      {
        id: "generic",
        prompt: "How can I help you today?",
        options: [{ value: "help", label: "Help me" }],
      },
    ],
  });

  assert.deepEqual(repaired.questions, []);
});

test("tool-call arguments take precedence over text", () => {
  const candidate = extractionCandidateFromContent([
    { type: "text", text: "not JSON" },
    {
      type: "toolCall",
      id: "call-1",
      name: "ask_user_question",
      arguments: { questions: [] },
    },
  ] as never);

  assert.equal(parseExtractionCandidate(candidate).ok, true);
});

test("multiple tool calls are rejected", () => {
  const candidate = extractionCandidateFromContent([
    {
      type: "toolCall",
      id: "call-1",
      name: "ask_user_question",
      arguments: { questions: [] },
    },
    {
      type: "toolCall",
      id: "call-2",
      name: "ask_user_question",
      arguments: { questions: [] },
    },
  ] as never);

  assert.equal(parseExtractionCandidate(candidate).ok, false);
});

test("fenced text remains a fallback", () => {
  const result = parseExtractionCandidate('```json\n{"questions":[]}\n```');
  assert.equal(result.ok, true);
});

test("semantic validation issues are returned for retry feedback", () => {
  const result = parseExtractionCandidate(
    JSON.stringify({
      questions: [
        {
          id: "duplicate",
          prompt: "First?",
          options: [{ value: "a", label: "A" }],
        },
        {
          id: "duplicate",
          prompt: "Second?",
          options: [{ value: "b", label: "B" }],
        },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.includes("duplicate")),
      true,
    );
  }
});
