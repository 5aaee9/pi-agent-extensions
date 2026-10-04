import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { parseRelayConfig } from "../config.ts";
import { addDaybreakProgram, addFastServiceTier } from "../relay-stream.ts";
import { relaysByProvider } from "../types.ts";

function model(api = "openai-codex-responses", provider = "relay", id = "gpt-6-astra") {
  relaysByProvider.set(
    "relay",
    parseRelayConfig("relay", { baseURL: "https://example.com", token: "test" }),
  );
  return { api, provider, id } as Model<any>;
}

afterEach(() => relaysByProvider.clear());

describe("request modes", () => {
  it.each(["openai-codex-responses", "openai-responses"])(
    "merges programs without mutation for %s",
    (api) => {
      const selected = model(api);
      const payload = {
        model: selected.id,
        access_programs: { future: "keep", cyber: "standard" },
      };
      const result = addDaybreakProgram(payload, selected, "daybreak_blue");
      expect(result).toEqual({
        ...payload,
        access_programs: { future: "keep", cyber: "daybreak_blue" },
      });
      expect(payload.access_programs.cyber).toBe("standard");
      expect(addFastServiceTier(result, selected, "ultrafast")).toEqual({
        ...result,
        service_tier: "ultrafast",
      });
      expect(addDaybreakProgram(result, selected, "standard")).toEqual(payload);
    },
  );

  it.each([
    ["anthropic-messages", "relay", "claude-opus-4-6"],
    ["openai-completions", "relay", "gpt-6-astra"],
    ["openai-responses", "other", "gpt-6-astra"],
    ["openai-responses", "relay", "grok-test"],
  ])("ignores unsupported model %s %s %s", (api, provider, id) => {
    const selected = model(api, provider, id);
    expect(addDaybreakProgram({ model: id }, selected, "daybreak_blue")).toBeUndefined();
    expect(addFastServiceTier({ model: id }, selected, "ultrafast")).toBeUndefined();
  });

  it("ignores malformed payloads and mismatched models", () => {
    const selected = model();
    for (const payload of [null, [], "bad", {}, { model: "other" }]) {
      expect(addDaybreakProgram(payload, selected, "daybreak_blue")).toBeUndefined();
      expect(addFastServiceTier(payload, selected, "ultrafast")).toBeUndefined();
    }
    for (const access_programs of [null, [], "bad"]) {
      expect(
        addDaybreakProgram({ model: selected.id, access_programs }, selected, "daybreak_blue"),
      ).toBeUndefined();
    }
    expect(addDaybreakProgram({}, undefined, "daybreak_blue")).toBeUndefined();
    expect(addFastServiceTier({}, undefined, "ultrafast")).toBeUndefined();
  });
});
