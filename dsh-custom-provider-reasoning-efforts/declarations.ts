/**
 * The declaration model this plugin supplies to a hand-written provider route.
 *
 * A route the installed pi-ai catalog does not ship has no catalog entry to
 * inherit reasoning capability from, so every one of its models resolves to
 * `reasoning: false` unless its `llm-pi-ai` profile entry carries
 * `reasoningEfforts`. The same entry carries the model's accepted request
 * modalities in `input`: a hand-declared vision model needs that field to be
 * usable, and a catalog model whose gateway cannot serve what the catalog
 * records needs it to strip the claim. This module is both fields' authoring
 * vocabulary: a reasoning declaration names the pi-ai thinking levels a model
 * offers and the wire spelling each level dispatches, or says `false` for a
 * model that cannot reason at all; a vision declaration names the request
 * modalities the model accepts, with `text` always present and `image` the
 * vision half.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/declarations
 */

import { THINKING_LEVELS, isThinkingLevel } from "./levels.ts";

/** Every request modality a model entry may declare, in declaration order. */
export const MODALITIES = ["text", "image"] as const;

/** One request modality a model entry may declare. */
export type Modality = (typeof MODALITIES)[number];

const MODALITY_SET: ReadonlySet<string> = new Set(MODALITIES);

/**
 * Whether a name is a request modality a model entry may declare.
 *
 * @param value - candidate modality name.
 * @returns true for one of {@link MODALITIES}.
 */
export function isModality(value: string): value is Modality {
  return MODALITY_SET.has(value);
}

/** One model's declared accepted request modalities, headed by `text`. */
export type ModelInput = readonly Modality[];

/**
 * Whether a value is a modality list rather than an effort declaration.
 *
 * A change's planned value is either a `ModelDeclaration` (a dict or `false`)
 * or a `ModelInput` (an array), and the answer has to render both; this is the
 * one test that distinguishes them without knowing which field the change
 * names.
 *
 * @param value - a planned field value.
 * @returns true when the value is a modality list.
 */
export function isModelInput(value: unknown): value is ModelInput {
  return Array.isArray(value);
}

/** One level's wire spelling; `null` is legal for `off` only and means dispatch sends nothing. */
export type EffortWire = string | null;

/** The levels one model offers, keyed by pi-ai thinking level. */
export type Efforts = Record<string, EffortWire>;

/** One model's declaration: the levels it offers, or `false` for a model that cannot reason. */
export type ModelDeclaration = false | Efforts;

/** Declarations keyed by provider route and then by exact model id. */
export type Declarations = Record<string, Record<string, ModelDeclaration>>;

/** Vision declarations keyed by provider route and then by exact model id. */
export type InputDeclarations = Record<string, Record<string, ModelInput>>;

/** A rejected declaration, naming the route, model, and level at fault. */
export class DeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeclarationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate one model's declaration.
 *
 * A declaration is rejected when it is empty, offers no level beyond `off`,
 * carries `null` or an empty string on a level that is not `off`, or names a
 * key that is not a pi-ai thinking level. Every rejection names the route, the
 * model, and — where one is at fault — the level.
 *
 * @param route - provider route the declaration belongs to, for diagnostics.
 * @param model - exact model id the declaration belongs to, for diagnostics.
 * @param raw - the declaration as the row configuration carried it.
 * @returns the validated declaration.
 * @throws DeclarationError when the declaration cannot be served.
 */
export function validateModelDeclaration(
  route: string,
  model: string,
  raw: unknown,
): ModelDeclaration {
  const where = `route "${route}" model "${model}"`;
  if (raw === false) return false;
  if (!isRecord(raw)) {
    throw new DeclarationError(
      `${where}: a declaration must be a level table or false, got ${JSON.stringify(raw)}`,
    );
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new DeclarationError(
      `${where}: the declaration is empty; name the offered levels, or set it to false`,
    );
  }
  const efforts: Efforts = {};
  let thinking = 0;
  for (const [level, wire] of entries) {
    if (!isThinkingLevel(level)) {
      throw new DeclarationError(
        `${where}: "${level}" is not a pi-ai thinking level (${THINKING_LEVELS.join(", ")})`,
      );
    }
    if (wire === null) {
      if (level !== "off") {
        throw new DeclarationError(
          `${where}: level "${level}" needs the wire value dispatch should send; only "off" may stay empty`,
        );
      }
      efforts[level] = null;
      continue;
    }
    if (typeof wire !== "string" || wire.length === 0) {
      throw new DeclarationError(
        `${where}: level "${level}" must be a non-empty string or null, got ${JSON.stringify(wire)}`,
      );
    }
    efforts[level] = wire;
    if (level !== "off") thinking += 1;
  }
  if (thinking === 0) {
    throw new DeclarationError(
      `${where}: the declaration offers no level beyond "off"; name a thinking level, or set it to false`,
    );
  }
  return efforts;
}

/**
 * Validate one model's vision declaration.
 *
 * A declaration is the request-modality list the model's `input` field will
 * carry: non-empty, every member in pi-ai's modality vocabulary, and always
 * containing `text`, because a model that could not accept text could serve no
 * ordinary request. An empty array is rejected rather than written anywhere —
 * `llm-pi-ai` reads an empty `input` list as "no answer" and falls through to
 * the catalog, so an explicit empty array cannot express a true claim. Every
 * rejection names the route, the model, and — where one is at fault — the
 * member.
 *
 * @param route - provider route the declaration belongs to, for diagnostics.
 * @param model - exact model id the declaration belongs to, for diagnostics.
 * @param raw - the array as the row configuration carried it.
 * @returns the validated modality list, in declaration order.
 * @throws DeclarationError when the declaration cannot be served.
 */
export function validateModelInput(route: string, model: string, raw: unknown): ModelInput {
  const where = `route "${route}" model "${model}"`;
  if (!Array.isArray(raw)) {
    throw new DeclarationError(
      `${where}: a vision declaration must be a modality array (${MODALITIES.join(", ")}), got ${JSON.stringify(raw)}`,
    );
  }
  for (const member of raw) {
    if (typeof member !== "string" || !isModality(member)) {
      throw new DeclarationError(
        `${where}: "${String(member)}" is not a pi-ai model modality (${MODALITIES.join(", ")})`,
      );
    }
  }
  if (raw.length === 0) {
    throw new DeclarationError(
      `${where}: the vision declaration names no modality; an empty list cannot express a claim — name "text", with "image" when the model serves it`,
    );
  }
  if (!raw.includes("text")) {
    throw new DeclarationError(
      `${where}: the vision declaration is missing "text"; a model accepts text whenever it is served at all`,
    );
  }
  return [...raw];
}

/**
 * Validate every vision declaration the row configuration carries, so a
 * malformed table fails the plugin's load instead of a later write.
 *
 * @param raw - the `vision` table as the row configuration carried it.
 * @returns the validated table.
 * @throws DeclarationError naming the first declaration that cannot be served.
 */
export function validateInputs(
  raw: Record<string, Record<string, unknown>> | undefined,
): InputDeclarations {
  const declarations: InputDeclarations = {};
  for (const [route, models] of Object.entries(raw ?? {})) {
    if (route.length === 0)
      throw new DeclarationError("a vision declaration names an empty provider route");
    const validated: Record<string, ModelInput> = {};
    for (const [model, value] of Object.entries(models)) {
      if (model.length === 0) {
        throw new DeclarationError(`route "${route}" vision table names an empty model id`);
      }
      validated[model] = validateModelInput(route, model, value);
    }
    if (Object.keys(validated).length === 0) {
      throw new DeclarationError(
        `route "${route}" declares no models in its vision table; remove the empty entry, or name its models`,
      );
    }
    declarations[route] = validated;
  }
  return declarations;
}

/**
 * Render a vision declaration for a human-readable answer.
 *
 * @param value - one validated declaration.
 * @returns the modalities in declaration order, `/`-joined.
 */
export function describeInput(value: ModelInput): string {
  return value.join("/") || "no modalities";
}

/**
 * Validate every declaration the row configuration carries, so a malformed
 * table fails the plugin's load instead of a later write.
 *
 * @param raw - the `providers` table as the row configuration carried it.
 * @returns the validated table.
 * @throws DeclarationError naming the first declaration that cannot be served.
 */
export function validateDeclarations(raw: Declarations | undefined): Declarations {
  const declarations: Declarations = {};
  for (const [route, models] of Object.entries(raw ?? {})) {
    if (route.length === 0)
      throw new DeclarationError("a declaration names an empty provider route");
    const validated: Record<string, ModelDeclaration> = {};
    for (const [model, value] of Object.entries(models)) {
      if (model.length === 0) {
        throw new DeclarationError(`route "${route}" names an empty model id`);
      }
      validated[model] = validateModelDeclaration(route, model, value);
    }
    if (Object.keys(validated).length === 0) {
      throw new DeclarationError(
        `route "${route}" declares no models; remove the empty entry, or name its models`,
      );
    }
    declarations[route] = validated;
  }
  return declarations;
}

/**
 * Render a declaration's levels for a human-readable answer.
 *
 * @param value - one validated declaration.
 * @returns the levels in escalation order, or the non-reasoning marker.
 */
export function describeEfforts(value: ModelDeclaration): string {
  if (value === false) return "no reasoning";
  const levels = THINKING_LEVELS.filter((level) => level in value);
  return levels.length === 0 ? "no levels" : levels.join("/");
}
