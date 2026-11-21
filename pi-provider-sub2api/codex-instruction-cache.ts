import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { relaysByProvider } from "./types.ts";
import { asRecord } from "./util.ts";

// Pinned to the templates Sub2API v0.2.24 injects for ordinary Codex OAuth.
// Commit 5c2982a81b46e2142d0143d2f83c1ce9c4da1d24, after strings.TrimSpace:
// backend/internal/pkg/openai/codex_gpt62_{sol,astra}.json instructions_template.
// The descriptors cite the 2026-11-17 Codex models response. A newer gateway
// prompt will not match until these files are updated.
const INSTRUCTION_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function readInstructions(name: string) {
  return readFileSync(join(INSTRUCTION_DIRECTORY, "data", name), "utf8");
}

export const GPT62_SOL_INSTRUCTIONS = readInstructions("codex-gpt62-sol-instructions.txt");
export const GPT62_ASTRA_INSTRUCTIONS = readInstructions("codex-gpt62-astra-instructions.txt");

// Turn-scoped on purpose. GPT-6.2 bills top-level instructions as uncached input,
// so this stays short. It exists so an unfixed gateway sees a non-blank field and
// does not replace it with the long default. The durable text is the leading
// developer message.
export const CODEX_TURN_INSTRUCTIONS =
  "Apply the developer instructions at the beginning of this input to the current request.";

const TEMPLATES = {
  "gpt-6.2-sol": GPT62_SOL_INSTRUCTIONS,
  "gpt-6.2-astra": GPT62_ASTRA_INSTRUCTIONS,
} as const;

export type Gpt62InstructionFamily = keyof typeof TEMPLATES;

// Same suffixes GPT62ModelID accepts. Other suffixes fall through to a different
// gateway prompt, so they are not rewritten here.
const INSTRUCTION_SUFFIXES = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "openai-compact",
]);

// Mirrors Sub2API CanonicalizeOpenAIModelAliasSpelling closely enough to recognize
// the same Sol and Astra spellings the gateway maps onto these two templates.
export function canonicalizeOpenAIModelId(modelId: string) {
  let model = modelId.trim();
  const slash = model.lastIndexOf("/");
  if (slash >= 0) model = model.slice(slash + 1).trim();
  model = model.toLowerCase();
  if (model.length === 0) return "";

  let normalized = model.replaceAll("_", "-");
  normalized = normalized.split(/\s+/u).join("-");
  while (normalized.includes("--")) normalized = normalized.replaceAll("--", "-");
  if (normalized.startsWith("gpt5")) normalized = `gpt-5${normalized.slice("gpt5".length)}`;
  if (!normalized.startsWith("gpt-") && !normalized.includes("codex")) return "";
  return normalized
    .replaceAll("gpt-5.4mini", "gpt-5.4-mini")
    .replaceAll("gpt-5.4nano", "gpt-5.4-nano")
    .replaceAll("gpt-5.3-codexspark", "gpt-5.3-codex-spark")
    .replaceAll("gpt-5.3codexspark", "gpt-5.3-codex-spark")
    .replaceAll("gpt-5.3codex", "gpt-5.3-codex");
}

export function gpt62InstructionFamily(modelId: string): Gpt62InstructionFamily | undefined {
  const canonical = canonicalizeOpenAIModelId(modelId);
  for (const family of Object.keys(TEMPLATES) as Gpt62InstructionFamily[]) {
    if (canonical === family) return family;
    const prefix = `${family}-`;
    if (canonical.startsWith(prefix) && INSTRUCTION_SUFFIXES.has(canonical.slice(prefix.length))) {
      return family;
    }
  }
  return undefined;
}

export function codexInstructionTemplate(modelId: string) {
  const family = gpt62InstructionFamily(modelId);
  return family === undefined ? undefined : TEMPLATES[family];
}

function instructionsAreBlank(request: Record<string, unknown>) {
  if (!Object.hasOwn(request, "instructions")) return true;
  const value = request.instructions;
  return typeof value !== "string" || value.trim().length === 0;
}

function isTextMessage(value: Record<string, unknown>) {
  return value.type === undefined || value.type === "message";
}

// Moves a covered model's stable Codex default into the cacheable developer prefix
// and keeps top-level instructions too short for an unfixed gateway to refill.
// Returns undefined when the payload should stay the object the caller holds.
export function cacheCodexInstructions(
  payload: unknown,
  model: { id: string; api: string } | undefined,
  enabled: boolean,
): Record<string, unknown> | undefined {
  if (!enabled || model?.api !== "openai-codex-responses") return undefined;
  const template = model === undefined ? undefined : codexInstructionTemplate(model.id);
  if (template === undefined || model === undefined) return undefined;

  const request = asRecord(payload);
  if (!request || request.model !== model.id || !Array.isArray(request.input)) return undefined;

  let changed = false;
  const input = request.input.map((item) => {
    const message = asRecord(item);
    // The gateway promotes every role:system item, including ones whose content
    // is not a plain string. Keep that text in input by renaming the role.
    if (!message || message.role !== "system") return item;
    changed = true;
    return { ...message, role: "developer" };
  });

  let instructions = request.instructions;
  if (instructionsAreBlank(request)) {
    const lead = asRecord(input[0]);
    const alreadyPresent =
      lead?.role === "developer" && lead.content === template && isTextMessage(lead);
    if (!alreadyPresent) {
      input.unshift({ type: "message", role: "developer", content: template });
      changed = true;
    }
    if (instructions !== CODEX_TURN_INSTRUCTIONS) {
      instructions = CODEX_TURN_INSTRUCTIONS;
      changed = true;
    }
  }

  return changed ? { ...request, instructions, input } : undefined;
}

export function applyCodexInstructionCache(
  payload: unknown,
  model: { provider: string; id: string; api: string } | undefined,
) {
  const enabled =
    model !== undefined && relaysByProvider.get(model.provider)?.cacheCodexInstructions === true;
  return cacheCodexInstructions(payload, model, enabled);
}
