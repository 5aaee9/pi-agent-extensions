/**
 * Plan the next `providers` value for the `llm-pi-ai` namespace.
 *
 * The plan operates on the profile patch's own raw providers value (the lean
 * layer a Models-page save also edits), never on the resolved configuration, so
 * a write adds only the declared fields instead of materializing every provider
 * default. Nothing is invented: an intent lands only when the profile already
 * declares the route with an explicit `models` list and that list already
 * declares the model, and every other intent is reported as a skip with the
 * reason it could not land. Each intent carries the model-entry field it
 * addresses — `reasoningEfforts` for a reasoning declaration, `input` for a
 * vision declaration — so one pass plans both fields of the same entry, and
 * each is compared against, or removed from, only its own field.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/plan
 */

import { isDeepStrictEqual } from "node:util";

import type { ModelDeclaration, ModelInput } from "./declarations.ts";

/** The model-entry field one intent and change names. */
export type ModelField = "reasoningEfforts" | "input" | "name" | "contextWindow" | "maxTokens";

/** The value one model-entry field carries. */
export type FieldValue = ModelDeclaration | ModelInput | string | number;

/** One route/model pair the plugin wants the configuration to carry. */
export interface Intent {
  /** The field this intent writes, `reasoningEfforts` when omitted. */
  readonly field?: ModelField;
  /**
   * How the field is written: `replace` overwrites the value (the capability
   * declarations', and a removed field is deleted), `fill` writes only when the
   * entry carries no value for the field (discovered metadata, which never
   * overrides an authored value).
   */
  readonly mode?: "replace" | "fill";
  readonly route: string;
  readonly model: string;
  /** The declaration to write; `undefined` removes the field. */
  readonly value: FieldValue | undefined;
}

/** One field the plan would change. */
export interface Change {
  /** The model-entry field this change writes. */
  readonly field: ModelField;
  readonly route: string;
  readonly model: string;
  /** The field's current value, or `undefined` when the entry carries none. */
  readonly before: unknown;
  /** The field's planned value, or `undefined` when it is removed. */
  readonly after: FieldValue | undefined;
}

/** One intent that cannot land, with the reason. */
export interface Skip {
  /** The model-entry field this skip's intent named. */
  readonly field: ModelField;
  readonly route: string;
  readonly model: string;
  readonly reason: string;
}

/** The planned providers value and what the plan did with every intent. */
export interface PlanResult {
  /** The next `providers` value, or `undefined` when the profile carries none. */
  readonly providers: Record<string, unknown> | undefined;
  readonly changes: readonly Change[];
  readonly skipped: readonly Skip[];
}

/** The field an intent without an explicit one addresses. */
const DEFAULT_FIELD: ModelField = "reasoningEfforts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compute the next `providers` value for one namespace's user layer.
 *
 * @param user - the descriptor's `user` value (the profile patch's own raw config).
 * @param intents - the route/model pairs to write, or remove when `value` is `undefined`.
 * @returns the planned providers value, the changes, and the skips.
 */
export function planProviders(user: unknown, intents: readonly Intent[]): PlanResult {
  const carried = isRecord(user) ? user["providers"] : undefined;
  const providers: Record<string, unknown> | undefined = isRecord(carried)
    ? structuredClone(carried)
    : undefined;
  const changes: Change[] = [];
  const skipped: Skip[] = [];
  if (providers === undefined) {
    for (const intent of intents) {
      skipped.push({
        field: intent.field ?? DEFAULT_FIELD,
        route: intent.route,
        model: intent.model,
        reason: "the profile carries no providers table for this namespace",
      });
    }
    return { providers: undefined, changes, skipped };
  }
  for (const intent of intents) {
    const field: ModelField = intent.field ?? DEFAULT_FIELD;
    const route = providers[intent.route];
    if (!isRecord(route)) {
      skipped.push({
        field,
        route: intent.route,
        model: intent.model,
        reason: `the profile does not declare route "${intent.route}"`,
      });
      continue;
    }
    const models = route["models"];
    if (!Array.isArray(models)) {
      skipped.push({
        field,
        route: intent.route,
        model: intent.model,
        reason: `route "${intent.route}" declares no explicit models list, so its models come from the installed catalog`,
      });
      continue;
    }
    const index = models.findIndex((entry) => isRecord(entry) && entry["id"] === intent.model);
    const entry: unknown = index < 0 ? undefined : models[index];
    if (!isRecord(entry)) {
      skipped.push({
        field,
        route: intent.route,
        model: intent.model,
        reason: `route "${intent.route}" does not declare model "${intent.model}"`,
      });
      continue;
    }
    const before: unknown = Object.hasOwn(entry, field) ? entry[field] : undefined;
    if (intent.mode === "fill" && Object.hasOwn(entry, field)) continue;
    if (isDeepStrictEqual(before, intent.value)) continue;
    const next: Record<string, unknown> = { ...entry };
    if (intent.value === undefined) Reflect.deleteProperty(next, field);
    else next[field] = intent.value;
    models[index] = next;
    changes.push({
      field,
      route: intent.route,
      model: intent.model,
      before,
      after: intent.value,
    });
  }
  return { providers, changes, skipped };
}
