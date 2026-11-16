import { relaysByProvider } from "./types.ts";
import type { PromptReplacement } from "./types.ts";
import { asRecord, isSafeModelId } from "./util.ts";

// `*` is the only wildcard. Everything else, including characters that are
// special in a regular expression, matches itself so a model ID can be named
// exactly.
const REGEX_METACHARACTER = /[\\^$.*+?()[\]{}|]/u;

function modelMatchesPattern(modelId: string, pattern: string): boolean {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else source += REGEX_METACHARACTER.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`, "u").test(modelId);
}

export function parsePromptReplacements(provider: string, value: unknown): PromptReplacement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`provider ${provider} promptReplacements must be an array`);
  }
  return value.map((rule, index) => parsePromptReplacement(provider, index, rule));
}

function parsePromptReplacement(
  provider: string,
  index: number,
  value: unknown,
): PromptReplacement {
  const label = `provider ${provider} promptReplacements[${index}]`;
  const rule = asRecord(value);
  if (!rule) throw new Error(`${label} must be an object`);

  if (!Array.isArray(rule.models) || rule.models.length === 0) {
    throw new Error(`${label}.models must be a non-empty array`);
  }
  const models = rule.models.map((pattern, patternIndex) => {
    if (!isSafeModelId(pattern)) {
      throw new Error(`${label}.models[${patternIndex}] must be a model ID or wildcard pattern`);
    }
    return pattern;
  });

  if (typeof rule.from !== "string" || rule.from.length === 0) {
    throw new Error(`${label}.from must be a non-empty string`);
  }
  if (typeof rule.to !== "string") {
    throw new Error(`${label}.to must be a string`);
  }
  return { models, from: rule.from, to: rule.to };
}

function ruleMatches(rule: PromptReplacement, modelId: string) {
  return rule.models.some((pattern) => modelMatchesPattern(modelId, pattern));
}

// Returns undefined when the payload should stay the object the caller already
// holds. A replacement is a new object with only `instructions` changed.
export function applyPromptReplacements(
  payload: unknown,
  model: { provider: string; id: string } | undefined,
): Record<string, unknown> | undefined {
  if (!model) return undefined;
  const rules = relaysByProvider.get(model.provider)?.promptReplacements;
  if (!rules || rules.length === 0) return undefined;

  const request = asRecord(payload);
  if (!request || request.model !== model.id || typeof request.instructions !== "string") {
    return undefined;
  }

  let instructions = request.instructions;
  for (const rule of rules) {
    if (rule.from.length === 0 || !ruleMatches(rule, model.id)) continue;
    if (!instructions.includes(rule.from)) continue;
    instructions = instructions.split(rule.from).join(rule.to);
  }
  return instructions === request.instructions ? undefined : { ...request, instructions };
}
