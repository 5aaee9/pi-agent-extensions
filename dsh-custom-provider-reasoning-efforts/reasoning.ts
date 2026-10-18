/**
 * Read a provider endpoint's model listing into the reasoning levels it
 * advertises.
 *
 * The Harness's own discovery reads the same listing for a model's identity,
 * context window, and output cap; reasoning is the field it drops. This module
 * keeps that shape and adds the halves a declaration needs: the level names an
 * entry publishes and the mapping from a level name to the wire spelling the
 * gateway accepts. Only names that are pi-ai thinking levels survive, `off`
 * maps to `null` (dispatch sends nothing), and every other level maps to
 * itself, because a gateway's published effort name is the only spelling that
 * can be derived without guessing. The same entry may publish the request
 * modalities it accepts — the OpenRouter-style `input_modalities` conventions
 * — and {@link modalitiesOf} reads those the same way: only what the endpoint
 * states, mapped onto pi-ai's own modality vocabulary, with everything else
 * dropped rather than guessed into a claim.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/reasoning
 */

import type { Efforts } from "./declarations.ts";
import { isModality, type Modality, type ModelInput } from "./declarations.ts";
import { isThinkingLevel } from "./levels.ts";

/** One model an endpoint listing advertises. */
export interface ListedModel {
  readonly id: string;
  /** The display name the entry publishes; absent when it publishes none. */
  readonly name?: string;
  /** The context capacity the entry publishes; absent when it publishes none. */
  readonly contextWindow?: number;
  /** The output cap the entry publishes; absent when it publishes none. */
  readonly maxTokens?: number;
  /** The levels the entry advertises; absent when it advertises none. */
  readonly efforts?: Efforts;
  /** The request modalities the entry publishes; absent when it publishes none. */
  readonly inputModalities?: ModelInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first non-empty string among the candidates. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** The first positive integer among the candidates, as the Harness probe reads them. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

/** The nested object one field carries, when it carries one. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** The display name an entry publishes, across the spellings gateways use. */
function nameOf(entry: Record<string, unknown>): string | undefined {
  return label(entry["name"], entry["display_name"], entry["displayName"]);
}

/** The context capacity an entry publishes, across the spellings gateways use. */
function contextWindowOf(entry: Record<string, unknown>): number | undefined {
  const limit = recordOf(entry["limit"]);
  const limits = recordOf(entry["limits"]);
  return capacity(
    entry["contextWindow"],
    entry["context_window"],
    entry["context_length"],
    entry["max_input_tokens"],
    limit?.["context"],
    limits?.["context"],
  );
}

/** The output cap an entry publishes, across the spellings gateways use. */
function maxTokensOf(entry: Record<string, unknown>): number | undefined {
  const limit = recordOf(entry["limit"]);
  const limits = recordOf(entry["limits"]);
  const topProvider = recordOf(entry["top_provider"]);
  return capacity(
    entry["maxOutputTokens"],
    entry["max_output_tokens"],
    entry["maxTokens"],
    entry["max_tokens"],
    limit?.["output"],
    limits?.["output"],
    topProvider?.["max_completion_tokens"],
  );
}

/** The metadata fields one listing entry publishes, when it publishes them. */
function metadataOf(
  entry: Record<string, unknown>,
): Pick<ListedModel, "name" | "contextWindow" | "maxTokens"> {
  const name = nameOf(entry);
  const contextWindow = contextWindowOf(entry);
  const maxTokens = maxTokensOf(entry);
  return {
    ...(name === undefined ? {} : { name }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

/** Push the level names one field carries, accepting string and object entries. */
function pushLevels(into: string[], raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (typeof item === "string") {
      into.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const name = label(item["effort"], item["level"], item["id"], item["name"]);
    if (name !== undefined) into.push(name);
  }
}

/** Every level name an entry publishes, across the spellings gateways use. */
function levelNames(entry: Record<string, unknown>): string[] {
  const names: string[] = [];
  pushLevels(names, entry["supported_reasoning_levels"]);
  pushLevels(names, entry["reasoning_levels"]);
  pushLevels(names, entry["supported_reasoning_efforts"]);
  const reasoning = entry["reasoning"];
  if (isRecord(reasoning)) {
    pushLevels(names, reasoning["efforts"]);
    pushLevels(names, reasoning["supported_efforts"]);
  }
  return names;
}

/**
 * The reasoning levels one listing entry advertises.
 *
 * @param entry - one object-valued listing entry.
 * @returns the levels a declaration can carry, or `undefined` when the entry
 *   advertises none, cannot reason, or names only levels pi-ai does not know.
 */
export function effortsOf(entry: Record<string, unknown>): Efforts | undefined {
  if (entry["reasoning"] === false) return undefined;
  const efforts: Efforts = {};
  let thinking = 0;
  for (const name of levelNames(entry)) {
    if (!isThinkingLevel(name)) continue;
    if (name === "off") {
      efforts["off"] = null;
      continue;
    }
    efforts[name] = name;
    thinking += 1;
  }
  return thinking === 0 ? undefined : efforts;
}

/**
 * Normalize one modality token a listing publishes.
 *
 * Gateways spell the same two modalities in several cases and prefixes;
 * `input-text` and `input-image` are the OpenRouter shapes, and the rest of a
 * token's vocabulary — audio, video, every case variant of the two pi-ai
 * names — is dropped rather than guessed into a claim.
 *
 * @param raw - one token from a published modality list.
 * @returns the pi-ai modality it names, or `undefined` for anything else.
 */
function modalityOf(raw: string): Modality | undefined {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^input-/, "");
  return isModality(name) ? name : undefined;
}

/** Push the modality names one field carries, accepting string and array members. */
function pushModalities(into: string[], raw: unknown): void {
  if (typeof raw === "string") {
    into.push(raw);
    return;
  }
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (typeof item === "string") into.push(item);
  }
}

/** Every modality token an entry publishes, across the spellings gateways use. */
function modalityNames(entry: Record<string, unknown>): string[] {
  const names: string[] = [];
  pushModalities(names, entry["input_modalities"]);
  pushModalities(names, entry["supported_input_modalities"]);
  const architecture = entry["architecture"];
  if (isRecord(architecture)) {
    pushModalities(names, architecture["input_modalities"]);
    pushModalities(names, architecture["modality"]);
  }
  const modalities = entry["modalities"];
  if (isRecord(modalities)) {
    pushModalities(names, modalities["input"]);
  } else {
    pushModalities(names, modalities);
  }
  return names;
}

/**
 * The request modalities one listing entry publishes.
 *
 * A joined spelling such as `text+image->text` — the `architecture.modality`
 * shape — is split on `->`, `/`, `+`, `,`, and whitespace before the tokens
 * are mapped.
 * The order the entry publishes is the order the list keeps; duplicates stay,
 * because the declaration the field feeds is what a profile entry accepts
 * written as-is.
 *
 * @param entry - one object-valued listing entry.
 * @returns the modalities a declaration can carry in published order, or
 *   `undefined` when the entry names none of the vocabulary.
 */
export function modalitiesOf(entry: Record<string, unknown>): ModelInput | undefined {
  const modalities: Modality[] = [];
  for (const name of modalityNames(entry)) {
    for (const part of name.split(/->|[/+,\s]+/)) {
      const modality = modalityOf(part);
      if (modality !== undefined) modalities.push(modality);
    }
  }
  return modalities.length === 0 ? undefined : modalities;
}

/**
 * Read one Codex-shaped capability manifest.
 *
 * A Sub2API-style relay answers `/backend-api/codex/models` with a `models`
 * array whose entries carry the upstream backend's slug and the efforts that
 * backend accepts under `supported_reasoning_levels` — the capability its
 * `/v1/models` inventory does not publish. A body that is not such a manifest
 * yields `undefined`, so a relay without the endpoint is not an error.
 *
 * @param body - the parsed JSON reply.
 * @returns the advertised models in manifest order, or `undefined` when the
 *   body is not a manifest.
 */
export function readManifestListing(body: unknown): ListedModel[] | undefined {
  if (!isRecord(body)) return undefined;
  const listed = body["models"];
  if (!Array.isArray(listed)) return undefined;
  const models: ListedModel[] = [];
  for (const raw of listed) {
    if (!isRecord(raw)) continue;
    const id = label(raw["slug"], raw["id"]);
    if (id === undefined) continue;
    const efforts = effortsOf(raw);
    const inputModalities = modalitiesOf(raw);
    models.push({
      id,
      ...metadataOf(raw),
      ...(efforts === undefined ? {} : { efforts }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    });
  }
  return models;
}

/**
 * Read one model-listing reply.
 *
 * The standard `data` array takes precedence; otherwise the enriched `models`
 * map some compatible gateways expose is read, with each property key as the
 * endpoint-facing id and the nested `id` as a fallback for an empty key.
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation.
 *
 * @param body - the parsed JSON reply.
 * @returns the advertised models in endpoint order.
 * @throws Error when the reply is not a model listing at all.
 */
export function readModelListing(body: unknown): ListedModel[] {
  if (!isRecord(body)) throw new Error("the endpoint's model listing is not a JSON object");
  const listed: Array<{ readonly key: string | undefined; readonly raw: Record<string, unknown> }> =
    [];
  const data = body["data"];
  if (Array.isArray(data)) {
    for (const raw of data) if (isRecord(raw)) listed.push({ key: undefined, raw });
  } else {
    const models = body["models"];
    if (!isRecord(models)) {
      throw new Error(
        'the endpoint\'s model listing has neither a "data" array nor a "models" object',
      );
    }
    for (const [key, raw] of Object.entries(models)) {
      if (isRecord(raw)) listed.push({ key, raw });
    }
  }
  const models: ListedModel[] = [];
  for (const { key, raw } of listed) {
    const id = label(key, raw["id"]);
    if (id === undefined) continue;
    const efforts = effortsOf(raw);
    const inputModalities = modalitiesOf(raw);
    models.push({
      id,
      ...metadataOf(raw),
      ...(efforts === undefined ? {} : { efforts }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    });
  }
  return models;
}
