import { describe, expect, it } from "vitest";
import { record, runAskTool } from "./host-plane.ts";

const question = {
  id: "goal",
  label: "Goal",
  prompt: "What should I optimize for?",
  options: [
    {
      value: "speed",
      label: "Speed",
      recommended: true,
      description: "Lowest implementation risk",
    },
    { value: "safety", label: "Safety" },
  ],
};
const params = { title: "Clarify next step", questions: [question] };

function toolResults(events: Record<string, unknown>[]) {
  return events.filter((event) => event.type === "tool_execution_end");
}
function result(event: Record<string, unknown> | undefined) {
  expect(event).toBeDefined();
  return record(event?.result);
}

describe("ask through the real Pi host", () => {
  for (const mode of ["json", "rpc"] as const) {
    it(`persists valid payloads and returns pending questions in ${mode} mode`, async () => {
      const run = await runAskTool([params], mode);
      const event = toolResults(run.events)[0];
      expect(event?.isError).toBe(false);
      expect(result(event)).toMatchObject({
        details: {
          cancelled: true,
          mode: "submit",
          questions: [{ id: "goal", label: "Goal", prompt: question.prompt, type: "single" }],
          answers: {},
        },
        content: [{ type: "text", text: expect.stringContaining("requires interactive TUI mode") }],
      });
      expect(JSON.stringify(result(event))).toContain("Speed [speed]");
      expect(JSON.stringify(result(event))).toContain("Type your own [custom]");
      expect(run.entries.filter((entry) => entry.customType === "ask:payload")).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            version: 1,
            source: "tool",
            sourceEntryId: "ask-call-0",
            params,
          }),
        }),
      ]);
      expect(run.requests).toHaveLength(2);
      const request = JSON.stringify(run.requests[0]);
      expect(request).toContain("grounded preferences");
      expect(request).toContain("@indexyz/pi-ask");
      expect(request).not.toContain("@eko24ive/pi-ask");
      expect(run.stderr).toBe("");
    });
  }

  it("prepares missing and blank labels before the host schema validation", async () => {
    const run = await runAskTool([
      {
        questions: [
          {
            ...question,
            options: [
              { value: "region-local-kms-reencrypt-dek" },
              { value: "follow_up", label: "  " },
              { value: "existing", label: "Existing label" },
            ],
          },
        ],
      },
    ]);
    expect(toolResults(run.events)[0]?.isError).toBe(false);
    const payload = run.entries.find((entry) => entry.customType === "ask:payload");
    expect(payload).toMatchObject({
      data: {
        params: {
          questions: [
            {
              options: [
                { label: "Region local kms reencrypt dek" },
                { label: "Follow up" },
                { label: "Existing label" },
              ],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(run.requests[1])).toContain("Region local kms reencrypt dek");
  });

  it("preserves preview fallback and normalizes blank presentation fields", async () => {
    const run = await runAskTool([
      {
        questions: [
          {
            ...question,
            type: "preview",
            options: [{ value: "compact", label: "Compact", preview: "A" }],
          },
        ],
      },
      {
        title: "   ",
        questions: [
          {
            ...question,
            label: "  ",
            options: [{ value: "small", label: "Small", description: " ", preview: "\t" }],
          },
        ],
      },
    ]);
    const events = toolResults(run.events);
    expect(events).toHaveLength(2);
    expect(JSON.stringify(result(events[0]))).toContain("Type your own [custom]");
    expect(result(events[1])).toMatchObject({ details: { questions: [{ label: "Q1" }] } });
    expect(record(result(events[1]).details).title).toBeUndefined();
  });

  it("rejects semantic errors without persisting an invalid ask payload", async () => {
    const run = await runAskTool([
      { questions: [question, { ...question, prompt: "Pick tone" }] },
      { questions: [] },
      {
        questions: [
          {
            ...question,
            type: "preview",
            options: [{ value: "compact", label: "Compact", preview: "  " }],
          },
        ],
      },
    ]);
    const events = toolResults(run.events);
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(result(event)).toMatchObject({
        details: {
          cancelled: true,
          mode: "submit",
          questions: [],
          answers: {},
          error: { kind: "invalid_input" },
        },
      });
    }
    expect(JSON.stringify(result(events[0]))).toContain("duplicate question id");
    expect(JSON.stringify(result(events[1]))).toContain("At least one question is required");
    expect(JSON.stringify(result(events[2]))).toContain("preview questions require preview text");
    expect(run.entries.some((entry) => entry.customType === "ask:payload")).toBe(false);
  });

  it("lets pi-schema reject missing values and unsupported question types before execution", async () => {
    const run = await runAskTool([
      { questions: [{ ...question, options: [{ label: "REST" }] }] },
      { questions: [{ ...question, type: "grid" }] },
    ]);
    const events = toolResults(run.events);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.isError).toBe(true);
      expect(JSON.stringify(result(event))).toContain("Validation failed");
    }
    expect(JSON.stringify(result(events[0]))).toContain("value");
    expect(JSON.stringify(result(events[1]))).toContain("type");
    expect(run.entries.some((entry) => entry.customType === "ask:payload")).toBe(false);
  });
});
