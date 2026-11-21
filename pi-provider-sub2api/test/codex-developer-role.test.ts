import { afterEach, describe, expect, it } from "vitest";

import { parseRelayConfig } from "../config.ts";
import {
  preserveCodexDeveloperPrompt,
  usesUncachedCodexInstructions,
} from "../codex-developer-role.ts";
import { applyPromptReplacements } from "../prompt-replacements.ts";
import { relaysByProvider } from "../types.ts";

const CLIENT = "Follow the repository rules.";
const GATEWAY_DEFAULT = "gateway-owned default that this plugin does not copy";
const sol = { id: "gpt-6.2-sol", api: "openai-codex-responses" };

function request(modelId: string, extra: Record<string, unknown> = {}) {
  return {
    model: modelId,
    input: [
      { role: "system", content: CLIENT },
      { role: "user", content: "Hi" },
    ],
    tools: [{ type: "function", name: "read" }],
    ...extra,
  };
}

// v0.2.24 ordinary Codex OAuth: a blank instructions field becomes the gateway
// default, and text-only system items are removed from input and prefixed onto
// that field. This is a local model of that rule, not a live token measurement.
function unfixedOrdinaryOAuth(payload: Record<string, unknown>, fallback: string) {
  const raw = payload.instructions;
  const blank = raw === undefined || typeof raw !== "string" || raw.trim().length === 0;
  let instructions = blank ? fallback : raw;
  const input: unknown[] = [];
  const promoted: string[] = [];
  for (const item of payload.input as unknown[]) {
    const message =
      item && typeof item === "object" ? (item as Record<string, unknown>) : undefined;
    if (message?.role === "system" && typeof message.content === "string") {
      if (message.content.length > 0) promoted.push(message.content);
      continue;
    }
    input.push(item);
  }
  if (promoted.length > 0) {
    const extracted = promoted.join("\n\n");
    instructions =
      typeof instructions === "string" && instructions.trim().length > 0
        ? `${extracted}\n\n${instructions}`
        : extracted;
  }
  return { ...payload, instructions, input };
}

afterEach(() => {
  relaysByProvider.clear();
});

describe("GPT-6.2 instruction billing", () => {
  it.each([
    "gpt-6.2",
    "gpt-6.2-sol",
    "openai/GPT-6.2-Astra",
    "gpt-6.2-sol-ultra",
    "gpt-6.10",
    "gpt-7",
  ])("treats %s as uncached top-level instructions", (modelId) => {
    expect(usesUncachedCodexInstructions(modelId)).toBe(true);
  });

  it.each(["gpt-5.4", "gpt-6", "gpt-6.1-sol", "claude-sonnet", "codex-mini"])(
    "leaves %s out",
    (modelId) => {
      expect(usesUncachedCodexInstructions(modelId)).toBe(false);
    },
  );
});

describe("preserveCodexDeveloperPrompt", () => {
  it("keeps Pi's system prompt in input and does not write instructions", () => {
    const payload = request("gpt-6.2-sol");
    const result = preserveCodexDeveloperPrompt(payload, sol);
    expect(result).toEqual({
      ...payload,
      input: [
        { role: "developer", content: CLIENT },
        { role: "user", content: "Hi" },
      ],
    });
    expect(result).not.toHaveProperty("instructions");
    expect(payload.input[0]).toEqual({ role: "system", content: CLIENT });

    const forwarded = unfixedOrdinaryOAuth(result ?? payload, GATEWAY_DEFAULT);
    expect(forwarded.instructions).toBe(GATEWAY_DEFAULT);
    expect(JSON.stringify(forwarded.instructions)).not.toContain(CLIENT);
    expect(forwarded.input).toEqual(result?.input);
    expect(preserveCodexDeveloperPrompt(result, sol)).toBeUndefined();
  });

  it("leaves an explicit instruction unchanged while still protecting the prompt", () => {
    const payload = request("gpt-6.2-sol", { instructions: "Focus on this turn." });
    const result = preserveCodexDeveloperPrompt(payload, sol);
    expect(result?.instructions).toBe("Focus on this turn.");
    expect(result?.input).toEqual([
      { role: "developer", content: CLIENT },
      { role: "user", content: "Hi" },
    ]);
    const forwarded = unfixedOrdinaryOAuth(result ?? payload, GATEWAY_DEFAULT);
    expect(forwarded.instructions).toBe("Focus on this turn.");
  });

  it("renames every system item and leaves a compaction trigger last", () => {
    const payload = {
      model: "gpt-7",
      input: [
        { role: "system", content: CLIENT },
        { type: "message", role: "system", content: [{ type: "input_text", text: "Later." }] },
        { role: "user", content: "Remember this" },
        { type: "compaction_trigger" },
      ],
      stream: true,
      store: false,
    };
    const result = preserveCodexDeveloperPrompt(payload, {
      id: "gpt-7",
      api: "openai-codex-responses",
    });
    expect(result?.input).toEqual([
      { role: "developer", content: CLIENT },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Later." }] },
      { role: "user", content: "Remember this" },
      { type: "compaction_trigger" },
    ]);
    expect(result).not.toHaveProperty("instructions");
    expect(result?.stream).toBe(true);
  });

  it("does not rewrite a prompt Pi already sent as developer", () => {
    const payload = request("gpt-6.2-sol", {
      input: [
        { role: "developer", content: CLIENT },
        { role: "user", content: "Hi" },
      ],
    });
    expect(preserveCodexDeveloperPrompt(payload, sol)).toBeUndefined();
  });

  it("leaves older models, other APIs, and mismatched payloads alone", () => {
    const older = request("gpt-5.4");
    expect(
      preserveCodexDeveloperPrompt(older, { id: "gpt-5.4", api: "openai-codex-responses" }),
    ).toBeUndefined();
    expect(
      preserveCodexDeveloperPrompt(request("gpt-6.1-sol"), {
        id: "gpt-6.1-sol",
        api: "openai-codex-responses",
      }),
    ).toBeUndefined();
    expect(
      preserveCodexDeveloperPrompt(request("gpt-6.2-sol"), { ...sol, api: "openai-responses" }),
    ).toBeUndefined();
    expect(preserveCodexDeveloperPrompt(request("other"), sol)).toBeUndefined();
    expect(preserveCodexDeveloperPrompt({ model: sol.id }, sol)).toBeUndefined();
  });

  it("renames the prompt after a replacement edits it", () => {
    relaysByProvider.set(
      "relay",
      parseRelayConfig("relay", {
        baseURL: "https://relay.example.com/v1",
        token: "token",
        api: "openai-codex-responses",
        promptReplacements: [{ models: ["*"], from: "rules", to: "checks" }],
      }),
    );
    const model = { provider: "relay", ...sol };
    const replaced =
      applyPromptReplacements(request("gpt-6.2-sol"), model) ?? request("gpt-6.2-sol");
    const result = preserveCodexDeveloperPrompt(replaced, model);
    expect(result?.input).toEqual([
      { role: "developer", content: "Follow the repository checks." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("ignores a leftover cacheCodexInstructions key", () => {
    const relay = parseRelayConfig("relay", {
      baseURL: "https://relay.example.com/v1",
      token: "token",
      api: "openai-codex-responses",
      cacheCodexInstructions: true,
    });
    expect(relay).not.toHaveProperty("cacheCodexInstructions");
  });
});
