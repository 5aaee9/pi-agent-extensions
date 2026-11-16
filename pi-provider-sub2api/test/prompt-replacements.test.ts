import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRelayConfig } from "../config.ts";
import { applyPromptReplacements } from "../prompt-replacements.ts";
import { relaysByProvider } from "../types.ts";

const IDENTITY =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const NEUTRAL = "You are a helpful, knowledgeable, and direct AI assistant.";
const TOKEN = "sk-secret-token";

const RULES = [
  {
    models: ["gemini-*", "claude-*"],
    from: IDENTITY,
    to: NEUTRAL,
  },
];

function entry(extra: Record<string, unknown> = {}) {
  return {
    baseURL: "https://relay.example.com/v1",
    token: TOKEN,
    api: "openai-codex-responses",
    ...extra,
  };
}

function install(provider: string, extra: Record<string, unknown> = {}) {
  const relay = parseRelayConfig(provider, entry(extra));
  relaysByProvider.set(provider, relay);
  return relay;
}

afterEach(() => {
  relaysByProvider.clear();
  vi.unstubAllEnvs();
});

describe("prompt replacement configuration", () => {
  it("loads the documented rules and drops an unknown rule field", () => {
    vi.stubEnv("SUB2API_TOKEN", "resolved-token");
    const relay = parseRelayConfig("sub2api", {
      ...entry({ token: "${SUB2API_TOKEN}" }),
      promptReplacements: [{ ...RULES[0], note: "antigravity" }],
    });
    expect(relay.apiKey).toBe("resolved-token");
    expect(relay.promptReplacements).toEqual(RULES);
  });

  it.each([
    ["omitted", {}],
    ["an empty list", { promptReplacements: [] }],
  ])("stores no rules when the field is %s", (_label, extra) => {
    expect(parseRelayConfig("relay", entry(extra)).promptReplacements).toEqual([]);
  });

  it.each([
    [{ promptReplacements: null }, "provider relay promptReplacements must be an array"],
    [{ promptReplacements: {} }, "provider relay promptReplacements must be an array"],
    [{ promptReplacements: [null] }, "provider relay promptReplacements[0] must be an object"],
    [
      { promptReplacements: [{}] },
      "provider relay promptReplacements[0].models must be a non-empty array",
    ],
    [
      { promptReplacements: [{ models: [] }] },
      "provider relay promptReplacements[0].models must be a non-empty array",
    ],
    [
      { promptReplacements: [{ models: [""] }] },
      "provider relay promptReplacements[0].models[0] must be a model ID or wildcard pattern",
    ],
    [
      { promptReplacements: [{ models: [" gemini-*"] }] },
      "provider relay promptReplacements[0].models[0] must be a model ID or wildcard pattern",
    ],
    [
      { promptReplacements: [{ models: ["gemini-\u0007*"] }] },
      "provider relay promptReplacements[0].models[0] must be a model ID or wildcard pattern",
    ],
    [
      { promptReplacements: [{ models: ["g".repeat(257)] }] },
      "provider relay promptReplacements[0].models[0] must be a model ID or wildcard pattern",
    ],
    [
      { promptReplacements: [{ models: ["gemini-*"], from: "" }] },
      "provider relay promptReplacements[0].from must be a non-empty string",
    ],
    [
      { promptReplacements: [{ models: ["*"], from: "a" }] },
      "provider relay promptReplacements[0].to must be a string",
    ],
    [
      { promptReplacements: [{ models: ["*"], from: "a", to: null }] },
      "provider relay promptReplacements[0].to must be a string",
    ],
  ])("rejects %j", (extra, message) => {
    const parse = () => parseRelayConfig("relay", entry(extra));
    expect(parse).toThrow(message);
    expect(parse).not.toThrow(TOKEN);
  });
});

describe("prompt replacement application", () => {
  const tools = [{ type: "function", name: "read" }];
  const input = [{ role: "user", content: "hello" }];

  function request(modelId: string, instructions: string) {
    return { model: modelId, instructions, tools, input, temperature: 0 };
  }

  it("replaces a matching family and leaves the surrounding prompt and payload", () => {
    install("relay", { promptReplacements: RULES });
    const payload = request(
      "gemini-2.5-pro",
      `before\n${IDENTITY}\nafter\n\n<rules>\n- Be concise in your responses\n</rules>`,
    );
    const result = applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" });
    expect(result).toEqual({
      ...payload,
      instructions: payload.instructions.replace(IDENTITY, NEUTRAL),
    });
    expect(result?.tools).toBe(tools);
    expect(result?.input).toBe(input);
    expect(payload.instructions).toContain(IDENTITY);
  });

  it.each([
    ["gemini-2.5-pro", NEUTRAL],
    ["gemini-", NEUTRAL],
    ["claude-sonnet-4-5", NEUTRAL],
    ["gemini", IDENTITY],
    ["my-gemini-2.5-pro", IDENTITY],
    ["Gemini-2.5-pro", IDENTITY],
    ["gpt-5.4", IDENTITY],
  ])("wildcard match for %s yields %s", (modelId, instructions) => {
    install("relay", { promptReplacements: RULES });
    const payload = request(modelId, IDENTITY);
    const result = applyPromptReplacements(payload, { provider: "relay", id: modelId });
    expect(result ?? payload).toEqual({ ...payload, instructions });
    expect(result === undefined).toBe(instructions === IDENTITY);
  });

  it("treats a pattern as a whole model ID and keeps regex characters literal", () => {
    install("relay", {
      promptReplacements: [
        { models: ["gpt-5.4"], from: "AA", to: "BB" },
        { models: ["a+b*"], from: "AA", to: "CC" },
      ],
    });
    expect(
      applyPromptReplacements(request("gpt-5.4", "AA"), { provider: "relay", id: "gpt-5.4" })
        ?.instructions,
    ).toBe("BB");
    expect(
      applyPromptReplacements(request("gpt-5.4-mini", "AA"), {
        provider: "relay",
        id: "gpt-5.4-mini",
      }),
    ).toBeUndefined();
    expect(
      applyPromptReplacements(request("gpt-5X4", "AA"), { provider: "relay", id: "gpt-5X4" }),
    ).toBeUndefined();
    expect(
      applyPromptReplacements(request("a+b-extra", "AA"), { provider: "relay", id: "a+b-extra" })
        ?.instructions,
    ).toBe("CC");
    expect(
      applyPromptReplacements(request("aaab", "AA"), { provider: "relay", id: "aaab" }),
    ).toBeUndefined();
  });

  it("applies a star to every model of that provider only", () => {
    install("relay", { promptReplacements: [{ models: ["*"], from: "AA", to: "BB" }] });
    install("plain");
    expect(
      applyPromptReplacements(request("gpt-5.4", "AA"), { provider: "relay", id: "gpt-5.4" })
        ?.instructions,
    ).toBe("BB");
    expect(
      applyPromptReplacements(request("gpt-5.4", "AA"), { provider: "plain", id: "gpt-5.4" }),
    ).toBeUndefined();
  });

  it("applies matching rules in declaration order and replaces every occurrence", () => {
    install("relay", {
      promptReplacements: [
        { models: ["gemini-*"], from: "AA", to: "BB" },
        { models: ["*"], from: "BB", to: "CC" },
        { models: ["gpt-*"], from: "CC", to: "DD" },
      ],
    });
    const result = applyPromptReplacements(request("gemini-2.5-pro", "AA AA"), {
      provider: "relay",
      id: "gemini-2.5-pro",
    });
    expect(result?.instructions).toBe("CC CC");
  });

  it("skips a missing phrase without failing and still runs a later rule", () => {
    install("relay", {
      promptReplacements: [
        { models: ["*"], from: "MISSING", to: "NO" },
        { models: ["gemini-*"], from: "AA", to: "BB" },
      ],
    });
    const payload = request("gemini-2.5-pro", "keep AA");
    expect(() =>
      applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" }),
    ).not.toThrow();
    expect(
      applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" })?.instructions,
    ).toBe("keep BB");
  });

  it("leaves the request when from is absent", () => {
    install("relay", { promptReplacements: RULES });
    const payload = request("gemini-2.5-pro", "tools, rules, and the project stay");
    expect(
      applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" }),
    ).toBeUndefined();
    expect(payload.instructions).toBe("tools, rules, and the project stay");
  });

  it("does not feed a replacement back into the same rule", () => {
    install("relay", { promptReplacements: [{ models: ["*"], from: "A", to: "AA" }] });
    expect(
      applyPromptReplacements(request("gemini-2.5-pro", "A"), {
        provider: "relay",
        id: "gemini-2.5-pro",
      })?.instructions,
    ).toBe("AA");
  });

  it("removes every occurrence when to is empty", () => {
    install("relay", { promptReplacements: [{ models: ["*"], from: "AA", to: "" }] });
    expect(
      applyPromptReplacements(request("gemini-2.5-pro", "AA and AA"), {
        provider: "relay",
        id: "gemini-2.5-pro",
      })?.instructions,
    ).toBe(" and ");
  });

  it.each([
    ["no rules", "relay", {}],
    ["another provider", "plain", { promptReplacements: RULES }],
  ])("is a no-op for %s", (_label, provider, extra) => {
    install("relay", extra);
    install("plain");
    const payload = request("gemini-2.5-pro", IDENTITY);
    expect(applyPromptReplacements(payload, { provider, id: "gemini-2.5-pro" })).toBeUndefined();
    expect(payload.instructions).toBe(IDENTITY);
  });

  it("ignores a payload built for a different model", () => {
    install("relay", { promptReplacements: RULES });
    const payload = request("other-model", IDENTITY);
    expect(
      applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" }),
    ).toBeUndefined();
  });

  it.each([
    ["missing", { model: "gemini-2.5-pro", tools }],
    ["an array", { model: "gemini-2.5-pro", instructions: [IDENTITY], tools }],
    ["an object", { model: "gemini-2.5-pro", instructions: { text: IDENTITY }, tools }],
  ])("leaves %s instructions unchanged", (_label, payload) => {
    install("relay", { promptReplacements: RULES });
    expect(
      applyPromptReplacements(payload, { provider: "relay", id: "gemini-2.5-pro" }),
    ).toBeUndefined();
    expect(payload).not.toHaveProperty("instructions", NEUTRAL);
  });

  it("does nothing without a current model or for a provider that is not a relay", () => {
    install("relay", { promptReplacements: RULES });
    const payload = request("gemini-2.5-pro", IDENTITY);
    expect(applyPromptReplacements(payload, undefined)).toBeUndefined();
    expect(
      applyPromptReplacements(payload, { provider: "openai", id: "gemini-2.5-pro" }),
    ).toBeUndefined();
  });
});
