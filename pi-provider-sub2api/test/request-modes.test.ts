import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { parseRelayConfig } from "../config.ts";
import { addDaybreakProgram, addServiceTier } from "../relay-stream.ts";
import { createRequestModeState } from "../request-modes.ts";
import { relaysByProvider } from "../types.ts";

// Synthetic OpenAI-shaped IDs: these tests cover protocol shape only and make
// no claim about which real models or accounts accept a tier or program.
const MODEL_A = "gpt-synthetic-a";
const MODEL_B = "gpt-synthetic-b";

function model(api = "openai-codex-responses", provider = "relay", id = MODEL_A) {
  relaysByProvider.set(
    "relay",
    parseRelayConfig("relay", { baseURL: "https://example.com", token: "test" }),
  );
  return { api, provider, id } as Model<any>;
}

function addRelay(provider: string, settings: Record<string, unknown> = {}) {
  const relay = parseRelayConfig(provider, {
    baseURL: "https://example.com",
    token: "test",
    ...settings,
  });
  relaysByProvider.set(provider, relay);
  return relay;
}

afterEach(() => relaysByProvider.clear());

describe("request mode injection", () => {
  it.each(["openai-responses"])("merges programs without mutation for %s", (api) => {
    const selected = model(api);
    const payload = {
      model: selected.id,
      access_programs: { future: "keep", cyber: "standard" },
    };
    const result = addDaybreakProgram(payload, selected, "blue");
    expect(result).toEqual({
      ...payload,
      access_programs: { future: "keep", cyber: "daybreak_blue" },
    });
    expect(payload.access_programs.cyber).toBe("standard");
    expect(addServiceTier(result, selected, "ultrafast")).toEqual({
      ...result,
      service_tier: "ultrafast",
    });
    expect(addDaybreakProgram(result, selected, "standard")).toEqual(payload);
  });

  it("ignores malformed payloads and mismatched models", () => {
    const selected = model();
    const other = { model: "other" };
    expect(addDaybreakProgram(other, selected, "blue")).toBeUndefined();
    expect(addServiceTier(other, selected, "ultrafast")).toBeUndefined();
  });
});

describe("request mode configuration", () => {
  it.each([
    [{ requestModes: null }, "provider relay requestModes must be an object"],
    [
      { requestModes: { serviceTier: null } },
      "provider relay requestModes.serviceTier must be default, fast, ultrafast",
    ],
    [
      { requestModes: { serviceTier: "priority" } },
      "provider relay requestModes.serviceTier must be default, fast, ultrafast",
    ],
    [
      { requestModes: { daybreak: "daybreak_blue" } },
      "provider relay requestModes.daybreak must be standard, blue",
    ],
    [{ modelRequestModes: null }, "provider relay modelRequestModes must be an object"],
    [{ modelRequestModes: [] }, "provider relay modelRequestModes must be an object"],
    [
      { modelRequestModes: { [MODEL_A]: null } },
      `provider relay modelRequestModes["${MODEL_A}"] must be an object`,
    ],
    [
      { modelRequestModes: { [MODEL_A]: { serviceTier: "turbo" } } },
      `provider relay modelRequestModes["${MODEL_A}"].serviceTier must be default, fast, ultrafast`,
    ],
    [
      { modelRequestModes: { [` ${MODEL_A}`]: {} } },
      `provider relay modelRequestModes has invalid model ID " ${MODEL_A}"`,
    ],
    [{ modelRequestModes: { "": {} } }, 'provider relay modelRequestModes has invalid model ID ""'],
    [
      { modelRequestModes: { "gpt\u0007": {} } },
      'provider relay modelRequestModes has invalid model ID "gpt\\u0007"',
    ],
    [
      { modelRequestModes: { ["g".repeat(257)]: {} } },
      "provider relay modelRequestModes has invalid model ID",
    ],
  ])("rejects invalid preferences %j", (settings, message) => {
    const parse = () =>
      parseRelayConfig("relay", {
        baseURL: "https://example.com",
        token: "sk-secret-token",
        ...settings,
      });
    expect(parse).toThrow(message);
    expect(parse).not.toThrow("sk-secret-token");
  });
});

describe("request mode resolution", () => {
  it("layers temporary state per provider and model without touching saved state", () => {
    const relay = addRelay("relay", {
      api: "openai-responses",
      requestModes: { serviceTier: "fast" },
    });
    addRelay("other", { api: "openai-responses" });
    const state = createRequestModeState();
    const a = { provider: "relay", id: MODEL_A, api: "openai-responses" } as Model<any>;
    const b = { provider: "relay", id: MODEL_B, api: "openai-responses" } as Model<any>;
    const otherA = { ...a, provider: "other" };

    state.set(a, { serviceTier: "ultrafast" });
    state.set(a, { daybreak: "blue" });
    expect(state.resolve(a)).toEqual({ serviceTier: "ultrafast", daybreak: "blue" });
    expect(state.resolve(b)).toEqual({ serviceTier: "fast" });
    expect(state.resolve(otherA)).toEqual({});
    state.set(a, { serviceTier: "default" });
    expect(state.resolve(a)).toEqual({ serviceTier: "default", daybreak: "blue" });
    expect(relay.requestModes).toEqual({ serviceTier: "fast" });
    expect(relay.modelRequestModes.size).toBe(0);

    // A fresh state (extension reload) discards unsaved preferences.
    expect(createRequestModeState().resolve(a)).toEqual({ serviceTier: "fast" });
  });

  it("filters active modes by protocol support", () => {
    addRelay("relay", {
      api: "openai-completions",
      requestModes: { serviceTier: "ultrafast", daybreak: "blue" },
    });
    const state = createRequestModeState();
    const completions = { provider: "relay", id: MODEL_A, api: "openai-completions" } as Model<any>;
    expect(state.resolve(completions)).toEqual({ serviceTier: "ultrafast", daybreak: "blue" });
    expect(state.active(completions)).toEqual({});
    state.set(completions, { serviceTier: "fast" });
    expect(state.active(completions)).toEqual({ serviceTier: "fast" });
    expect(state.active({ ...completions, api: "openai-responses" })).toEqual({
      serviceTier: "fast",
      daybreak: "blue",
    });
    expect(state.active({ ...completions, id: "grok-test" })).toEqual({});
    expect(state.active({ ...completions, id: "gpt-synthetic\u0007" })).toEqual({});
    expect(state.active({ ...completions, api: "anthropic-messages" })).toEqual({});
    expect(state.active(undefined)).toEqual({});
  });
});
