import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { parseRelayConfig } from "../config.ts";
import {
  CODEX_TURN_INSTRUCTIONS,
  GPT62_ASTRA_INSTRUCTIONS,
  GPT62_SOL_INSTRUCTIONS,
  applyCodexInstructionCache,
  cacheCodexInstructions,
  codexInstructionTemplate,
  gpt62InstructionFamily,
} from "../codex-instruction-cache.ts";
import { applyPromptReplacements } from "../prompt-replacements.ts";
import { relaysByProvider } from "../types.ts";

const TOKEN = "sk-secret-token";
const CLIENT = "Follow the repository rules.";
const SOL_SHA256 = "fe5b2de478b7122e403f936d5994a8bb08e104281c9604ac5cd3391f4886cea5";
const ASTRA_SHA256 = "352874c1758867ea0bdc2dabd3362df33342ba24d46bac360b4ad7bc9f1a42f8";

const sol = { provider: "relay", id: "gpt-6.2-sol", api: "openai-codex-responses" };

function entry(extra: Record<string, unknown> = {}) {
  return {
    baseURL: "https://relay.example.com/v1",
    token: TOKEN,
    api: "openai-codex-responses",
    ...extra,
  };
}

function request(modelId: string, extra: Record<string, unknown> = {}) {
  return {
    model: modelId,
    input: [
      { role: "developer", content: CLIENT },
      { role: "user", content: "Hi" },
    ],
    tools: [{ type: "function", name: "read" }],
    ...extra,
  };
}

// The v0.2.24 ordinary Codex OAuth rule this option is measured against.
// A blank instructions field is replaced with the long default, and text-only
// system items are removed from input and prefixed onto instructions.
function contentAt(payload: Record<string, unknown> | undefined, index: number) {
  if (!payload || !Array.isArray(payload.input)) throw new Error("missing rewritten input");
  const item = payload.input[index];
  if (!item || typeof item !== "object" || !("content" in item)) {
    throw new Error(`missing content at ${String(index)}`);
  }
  return item.content;
}

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

describe("GPT-6.2 instruction families", () => {
  it("pins the trimmed v0.2.24 templates", () => {
    expect(createHash("sha256").update(GPT62_SOL_INSTRUCTIONS).digest("hex")).toBe(SOL_SHA256);
    expect(createHash("sha256").update(GPT62_ASTRA_INSTRUCTIONS).digest("hex")).toBe(ASTRA_SHA256);
    expect(GPT62_SOL_INSTRUCTIONS.length).toBeGreaterThan(CODEX_TURN_INSTRUCTIONS.length);
    expect(GPT62_ASTRA_INSTRUCTIONS.endsWith("\n")).toBe(false);
  });

  it.each([
    ["gpt-6.2-sol", "gpt-6.2-sol"],
    ["openai/GPT-6.2-Sol", "gpt-6.2-sol"],
    ["gpt-6.2-sol-high", "gpt-6.2-sol"],
    ["gpt-6.2-sol-openai-compact", "gpt-6.2-sol"],
    ["gpt-6.2-astra-xhigh", "gpt-6.2-astra"],
    ["GPT_6.2_ASTRA", "gpt-6.2-astra"],
  ])("maps %s onto %s", (modelId, family) => {
    expect(gpt62InstructionFamily(modelId)).toBe(family);
    expect(codexInstructionTemplate(modelId)).toBe(
      family === "gpt-6.2-sol" ? GPT62_SOL_INSTRUCTIONS : GPT62_ASTRA_INSTRUCTIONS,
    );
  });

  it.each([
    "gpt-5.4",
    "gpt-6.1-sol",
    "gpt-6.2",
    "gpt-6.2-sol-ultra",
    "gpt-6.3-sol",
    "claude-sonnet",
  ])("leaves %s without a pinned template", (modelId) => {
    expect(gpt62InstructionFamily(modelId)).toBeUndefined();
  });
});

describe("cacheCodexInstructions", () => {
  it("moves a blank-instructions default into the leading developer message", () => {
    const payload = request("gpt-6.2-sol");
    const result = cacheCodexInstructions(payload, sol, true);
    expect(result).toEqual({
      ...payload,
      instructions: CODEX_TURN_INSTRUCTIONS,
      input: [
        { type: "message", role: "developer", content: GPT62_SOL_INSTRUCTIONS },
        ...payload.input,
      ],
    });
    expect(payload.input).toHaveLength(2);

    const forwarded = unfixedOrdinaryOAuth(result ?? payload, GPT62_SOL_INSTRUCTIONS);
    expect(forwarded.instructions).toBe(CODEX_TURN_INSTRUCTIONS);
    expect(JSON.stringify(forwarded.instructions)).not.toContain(GPT62_SOL_INSTRUCTIONS);
    expect(contentAt(forwarded, 0)).toBe(GPT62_SOL_INSTRUCTIONS);
    expect(cacheCodexInstructions(result, sol, true)).toBeUndefined();
  });

  it.each([undefined, "", " \n\t", 0])("treats instructions %j as blank", (instructions) => {
    const result = cacheCodexInstructions(
      request("gpt-6.2-astra", instructions === undefined ? {} : { instructions }),
      { ...sol, id: "gpt-6.2-astra" },
      true,
    );
    expect(result?.instructions).toBe(CODEX_TURN_INSTRUCTIONS);
    expect(contentAt(result, 0)).toBe(GPT62_ASTRA_INSTRUCTIONS);
  });

  it("keeps an explicit instruction and still stops system text from being promoted", () => {
    const payload = request("gpt-6.2-sol-high", {
      model: "gpt-6.2-sol-high",
      instructions: "Focus on this turn.",
      input: [
        { role: "system", content: CLIENT },
        { type: "message", role: "system", content: [{ type: "input_text", text: "Later." }] },
        { role: "user", content: "Hi" },
      ],
    });
    const result = cacheCodexInstructions(payload, { ...sol, id: "gpt-6.2-sol-high" }, true);
    expect(result?.instructions).toBe("Focus on this turn.");
    expect(result?.input).toEqual([
      { role: "developer", content: CLIENT },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Later." }] },
      { role: "user", content: "Hi" },
    ]);
    const forwarded = unfixedOrdinaryOAuth(result ?? payload, GPT62_SOL_INSTRUCTIONS);
    expect(forwarded.instructions).toBe("Focus on this turn.");
    expect(forwarded.input).toEqual(result?.input);
  });

  it("keeps a compaction trigger after the pinned default", () => {
    const payload = {
      model: "gpt-6.2-sol",
      input: [
        { role: "system", content: CLIENT },
        { role: "user", content: "Remember this" },
        { type: "compaction_trigger" },
      ],
      stream: true,
      store: false,
    };
    const result = cacheCodexInstructions(payload, sol, true);
    expect(result?.instructions).toBe(CODEX_TURN_INSTRUCTIONS);
    expect(result?.input).toEqual([
      { type: "message", role: "developer", content: GPT62_SOL_INSTRUCTIONS },
      { role: "developer", content: CLIENT },
      { role: "user", content: "Remember this" },
      { type: "compaction_trigger" },
    ]);
    expect(result?.stream).toBe(true);
    expect(unfixedOrdinaryOAuth(payload, GPT62_SOL_INSTRUCTIONS).instructions).toContain(
      GPT62_SOL_INSTRUCTIONS,
    );
  });

  it("does not rewrite when disabled, uncovered, or already prepared", () => {
    const payload = request("gpt-6.2-sol");
    expect(cacheCodexInstructions(payload, sol, false)).toBeUndefined();
    expect(
      cacheCodexInstructions(payload, { ...sol, api: "openai-responses" }, true),
    ).toBeUndefined();
    expect(
      cacheCodexInstructions(request("gpt-5.4"), { ...sol, id: "gpt-5.4" }, true),
    ).toBeUndefined();
    expect(cacheCodexInstructions(request("other"), sol, true)).toBeUndefined();
    expect(cacheCodexInstructions({ model: sol.id }, sol, true)).toBeUndefined();

    const prepared = cacheCodexInstructions(payload, sol, true);
    expect(cacheCodexInstructions(prepared, sol, true)).toBeUndefined();
  });

  it("leaves Pi's replaced prompt after the pinned default", () => {
    relaysByProvider.set(
      "relay",
      parseRelayConfig(
        "relay",
        entry({ promptReplacements: [{ models: ["*"], from: "rules", to: "checks" }] }),
      ),
    );
    const replaced = applyPromptReplacements(request("gpt-6.2-sol"), sol) ?? request("gpt-6.2-sol");
    const result = cacheCodexInstructions(replaced, sol, true);
    expect(contentAt(result, 0)).toBe(GPT62_SOL_INSTRUCTIONS);
    expect(contentAt(result, 1)).toBe("Follow the repository checks.");
  });
});

describe("cacheCodexInstructions configuration", () => {
  it("defaults off and can be enabled per provider", () => {
    expect(parseRelayConfig("relay", entry()).cacheCodexInstructions).toBe(false);
    expect(
      parseRelayConfig("relay", entry({ cacheCodexInstructions: true })).cacheCodexInstructions,
    ).toBe(true);
    const payload = request("gpt-6.2-sol");
    expect(applyCodexInstructionCache(payload, sol)).toBeUndefined();
    relaysByProvider.set(
      "relay",
      parseRelayConfig("relay", entry({ cacheCodexInstructions: true })),
    );
    expect(applyCodexInstructionCache(payload, sol)?.instructions).toBe(CODEX_TURN_INSTRUCTIONS);
    expect(applyCodexInstructionCache(payload, { ...sol, provider: "plain" })).toBeUndefined();
  });

  it("rejects a non-boolean without including the token", () => {
    const parse = () => parseRelayConfig("relay", entry({ cacheCodexInstructions: "yes" }));
    expect(parse).toThrow("provider relay cacheCodexInstructions must be a boolean");
    let message = "";
    try {
      parse();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(TOKEN);
  });
});
