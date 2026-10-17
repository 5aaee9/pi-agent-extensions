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
  it.each(["openai-codex-responses", "openai-responses"])(
    "merges programs without mutation for %s",
    (api) => {
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
    },
  );

  it.each([
    ["default", "default"],
    ["fast", "priority"],
    ["ultrafast", "ultrafast"],
  ] as const)("maps tier %s to service_tier %s", (tier, wire) => {
    const selected = model("openai-responses");
    expect(addServiceTier({ model: selected.id, service_tier: "auto" }, selected, tier)).toEqual({
      model: selected.id,
      service_tier: wire,
    });
  });

  it("keeps default and Fast but not Ultrafast or Daybreak on Chat Completions", () => {
    const selected = model("openai-completions");
    const payload = { model: selected.id };
    expect(addServiceTier(payload, selected, "fast")).toEqual({
      ...payload,
      service_tier: "priority",
    });
    expect(addServiceTier(payload, selected, "default")).toEqual({
      ...payload,
      service_tier: "default",
    });
    expect(addServiceTier(payload, selected, "ultrafast")).toBeUndefined();
    expect(addDaybreakProgram(payload, selected, "blue")).toBeUndefined();
  });

  it.each([
    ["anthropic-messages", "relay", "claude-synthetic"],
    ["openai-responses", "other", MODEL_A],
    ["openai-responses", "relay", "grok-test"],
  ])("ignores unsupported model %s %s %s", (api, provider, id) => {
    const selected = model(api, provider, id);
    for (const tier of ["default", "fast", "ultrafast"] as const) {
      expect(addServiceTier({ model: id }, selected, tier)).toBeUndefined();
    }
    expect(addDaybreakProgram({ model: id }, selected, "blue")).toBeUndefined();
  });

  it("ignores malformed payloads and mismatched models", () => {
    const selected = model();
    for (const payload of [null, [], "bad", {}, { model: "other" }]) {
      expect(addDaybreakProgram(payload, selected, "blue")).toBeUndefined();
      expect(addServiceTier(payload, selected, "ultrafast")).toBeUndefined();
    }
    for (const access_programs of [null, [], "bad"]) {
      expect(
        addDaybreakProgram({ model: selected.id, access_programs }, selected, "blue"),
      ).toBeUndefined();
    }
    expect(addDaybreakProgram({}, undefined, "blue")).toBeUndefined();
    expect(addServiceTier({}, undefined, "ultrafast")).toBeUndefined();
  });
});

describe("request mode configuration", () => {
  it("defaults to no preferences", () => {
    const relay = addRelay("relay");
    expect(relay.requestModes).toEqual({});
    expect(relay.modelRequestModes.size).toBe(0);
  });

  it("parses provider defaults, partial model overrides, and explicit off states", () => {
    const relay = addRelay("relay", {
      requestModes: { serviceTier: "fast", daybreak: "blue" },
      modelRequestModes: {
        [MODEL_A]: { serviceTier: "default" },
        [MODEL_B]: { serviceTier: "default", daybreak: "standard" },
        "gpt-synthetic-empty": {},
      },
    });
    expect(relay.requestModes).toEqual({ serviceTier: "fast", daybreak: "blue" });
    expect(Object.fromEntries(relay.modelRequestModes)).toEqual({
      [MODEL_A]: { serviceTier: "default" },
      [MODEL_B]: { serviceTier: "default", daybreak: "standard" },
      "gpt-synthetic-empty": {},
    });
  });

  it.each([
    [{ requestModes: null }, "provider relay requestModes must be an object"],
    [{ requestModes: [] }, "provider relay requestModes must be an object"],
    [{ requestModes: "fast" }, "provider relay requestModes must be an object"],
    [
      { requestModes: { serviceTier: null } },
      "provider relay requestModes.serviceTier must be default, fast, ultrafast",
    ],
    [
      { requestModes: { serviceTier: "priority" } },
      "provider relay requestModes.serviceTier must be default, fast, ultrafast",
    ],
    [
      { requestModes: { daybreak: true } },
      "provider relay requestModes.daybreak must be standard, blue",
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

  it("validates preferences before resolving an environment token", () => {
    expect(() =>
      parseRelayConfig("relay", {
        baseURL: "https://example.com",
        token: "${SUB2API_UNSET_TEST_TOKEN}",
        requestModes: { serviceTier: "bad" },
      }),
    ).toThrow("requestModes.serviceTier");
  });
});

describe("request mode resolution", () => {
  it("inherits field by field and isolates providers", () => {
    addRelay("relay", {
      api: "openai-responses",
      requestModes: { serviceTier: "fast", daybreak: "blue" },
      modelRequestModes: { [MODEL_A]: { serviceTier: "default" } },
    });
    addRelay("other", { api: "openai-responses" });
    const state = createRequestModeState();
    const a = { provider: "relay", id: MODEL_A, api: "openai-responses" } as Model<any>;
    const b = { provider: "relay", id: MODEL_B, api: "openai-responses" } as Model<any>;
    expect(state.resolve(a)).toEqual({ serviceTier: "default", daybreak: "blue" });
    expect(state.resolve(b)).toEqual({ serviceTier: "fast", daybreak: "blue" });
    expect(state.resolve({ ...a, provider: "other" })).toEqual({});
    expect(state.resolve({ ...a, provider: "unknown" })).toEqual({});
  });

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
