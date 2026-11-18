import { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { applyTaskMutation } from "../state/state-reducer.ts";
import { buildToolResult } from "../tool/response-envelope.ts";
import { renderTodoResult } from "../view/format.ts";

describe("reopened todo transcripts", () => {
  it("renders the status of a field-only update after JSON round-trip", () => {
    const theme = new Theme(
      { warning: "#ffaa00", muted: "", text: "", thinkingXhigh: "" } as ConstructorParameters<
        typeof Theme
      >[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
    const params = { id: 1, subject: "Rename task" };
    const { state, op } = applyTaskMutation(
      { tasks: [{ id: 1, subject: "Old", status: "in_progress" }], nextId: 2 },
      "update",
      params,
    );
    const result = buildToolResult("update", params, state, op);
    expect(
      renderTodoResult(JSON.parse(JSON.stringify(result)), theme)
        .render(80)
        .join("\n"),
    ).toContain("in progress");
  });
});
