// Helpers for offline catalog scenarios: both sides of each comparison come from one
// process state, with no catalog refresh between them.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { modelsOf } from "./pi.ts";
import type { RpcClient } from "./pi.ts";
import type { Scenario } from "./scenario.ts";

export const ANTHROPIC = "anthropic-messages";
export const RESPONSES = "openai-responses";
export const DEFAULT_CONTEXT = 200_000;
export const DEFAULT_OUTPUT = 16_384;
/** A relay address for scenarios that never send a request. */
export const UNROUTABLE = "http://127.0.0.1:9/v1";
const PLACEHOLDER_KEYS = {
  OPENAI_API_KEY: "placeholder",
  ANTHROPIC_API_KEY: "placeholder",
  XAI_API_KEY: "placeholder",
};

export const limitsOf = (model: JsonRecord): readonly unknown[] => [
  model["contextWindow"],
  model["maxTokens"],
];

export const costOf = (model: JsonRecord): JsonRecord => {
  const cost = model["cost"];
  return isRecord(cost) ? cost : {};
};

export const scaled = (cost: JsonRecord, by: number): JsonRecord => ({
  ...cost,
  input: Number(cost["input"]) * by,
  output: Number(cost["output"]) * by,
  cacheRead: Number(cost["cacheRead"]) * by,
  cacheWrite: Number(cost["cacheWrite"]) * by,
  tiers: Array.isArray(cost["tiers"])
    ? cost["tiers"].map((tier: unknown) => (isRecord(tier) ? scaled(tier, by) : tier))
    : undefined,
});

/** Drops undefined fields, so two prices compare by what they would serialize to. */
export const sameJson = (value: unknown): unknown => {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed;
};

/** A built-in model whose output cap differs from the relay-safe default. */
export const builtinWithLargeOutput = (
  models: readonly JsonRecord[],
  provider: string,
): JsonRecord => {
  const found = models.find(
    (model) =>
      model["provider"] === provider &&
      Number(model["maxTokens"]) > DEFAULT_OUTPUT &&
      Number(model["contextWindow"]) !== DEFAULT_CONTEXT,
  );
  return found ?? assert.fail(`Pi lists no suitable ${provider} model`);
};

export const opened = (context: Scenario): RpcClient =>
  context.rpc(["--session-dir", context.world.sessionDir], { env: PLACEHOLDER_KEYS });

export const listAll = async (client: RpcClient): Promise<readonly JsonRecord[]> => {
  const models = modelsOf(await client.send({ type: "get_available_models" }));
  return models;
};
