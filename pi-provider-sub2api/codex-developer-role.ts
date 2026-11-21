import { asRecord } from "./util.ts";

// Mirrors the spelling cleanup Sub2API uses before it decides which Codex
// prompt family a model ID belongs to. Only the version prefix is needed here.
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
  return normalized;
}

// GPT-6.2 and later bill top-level Responses instructions as uncached input.
export function usesUncachedCodexInstructions(modelId: string) {
  const match = /^gpt-(\d+)(?:\.(\d+))?/u.exec(canonicalizeOpenAIModelId(modelId));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  return major > 6 || (major === 6 && minor >= 2);
}

// Pi 1.6.0 omits top-level instructions. A reasoning Codex model already sends
// its system prompt as the leading developer message. A model that is not
// marked as reasoning sends that same prompt as system, and an unfixed Codex
// OAuth gateway then copies it into instructions. Renaming the role keeps Pi's
// own text in input. The gateway's own default, if it still injects one, is
// left untouched.
export function preserveCodexDeveloperPrompt(
  payload: unknown,
  model: { id: string; api: string } | undefined,
): Record<string, unknown> | undefined {
  if (model?.api !== "openai-codex-responses" || !usesUncachedCodexInstructions(model.id)) {
    return undefined;
  }
  const request = asRecord(payload);
  if (!request || request.model !== model.id || !Array.isArray(request.input)) return undefined;

  let changed = false;
  const input = request.input.map((item) => {
    const message = asRecord(item);
    if (!message || message.role !== "system") return item;
    changed = true;
    return { ...message, role: "developer" };
  });
  return changed ? { ...request, input } : undefined;
}
