import type { Model } from "@earendil-works/pi-ai";

import { relaysByProvider } from "./types.ts";
import { asRecord } from "./util.ts";

// Keywords whose value is a map of schemas: its keys are names, never keywords.
const SCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
];
// Keywords whose value is a schema or a list of schemas.
const SCHEMA_KEYWORDS = [
  "items",
  "prefixItems",
  "additionalItems",
  "contains",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "propertyNames",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
];

function isUntypedStringEnum(node: Record<string, unknown>): boolean {
  const values = node.enum;
  return (
    node.type === undefined &&
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === "string")
  );
}

function mapPreservingIdentity(list: readonly unknown[]): readonly unknown[] {
  const mapped = list.map((item) => withStringEnumTypes(item));
  return mapped.every((item, index) => item === list[index]) ? list : mapped;
}

function mapSchemaMap(value: unknown): unknown {
  const map = asRecord(value);
  if (!map) return value;
  const entries = Object.entries(map);
  const mapped = entries.map(([name, schema]) => [name, withStringEnumTypes(schema)] as const);
  return mapped.every(([name, schema]) => schema === map[name]) ? map : Object.fromEntries(mapped);
}

/**
 * Add `type: "string"` to every enum of only strings that has no type.
 *
 * Kimi's validator rejects a request over one such enum. The enum already limits the values, so
 * the type accepts exactly what it did before, which is why every relay model can receive it.
 * Other enums stay as they are: not every provider accepts a typed enum of numbers or a list of
 * types. Unchanged schemas keep their identity, so a caller can tell whether anything changed.
 */
export function withStringEnumTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return mapPreservingIdentity(schema);
  const node = asRecord(schema);
  if (!node) return schema;

  let result = isUntypedStringEnum(node) ? { type: "string", ...node } : node;
  const replace = (keyword: string, value: unknown) => {
    if (value === node[keyword]) return;
    if (result === node) result = { ...node };
    result[keyword] = value;
  };
  for (const keyword of SCHEMA_MAP_KEYWORDS) replace(keyword, mapSchemaMap(node[keyword]));
  for (const keyword of SCHEMA_KEYWORDS) replace(keyword, withStringEnumTypes(node[keyword]));
  return result;
}

function toolWithStringEnumTypes(tool: unknown): unknown {
  const record = asRecord(tool);
  if (!record) return tool;
  // Chat Completions wraps the tool in `function`; Anthropic calls the schema `input_schema`.
  const wrapped = asRecord(record.function);
  if (wrapped) {
    const parameters = withStringEnumTypes(wrapped.parameters);
    return parameters === wrapped.parameters
      ? tool
      : { ...record, function: { ...wrapped, parameters } };
  }
  const keyword = record.input_schema === undefined ? "parameters" : "input_schema";
  const schema = withStringEnumTypes(record[keyword]);
  return schema === record[keyword] ? tool : { ...record, [keyword]: schema };
}

export function addStringEnumTypes(payload: unknown, model: Model<any> | undefined) {
  if (!model || !relaysByProvider.has(model.provider)) return undefined;
  const request = asRecord(payload);
  if (!request || request.model !== model.id || !Array.isArray(request.tools)) return undefined;
  const tools: readonly unknown[] = request.tools;
  const typed = tools.map((tool) => toolWithStringEnumTypes(tool));
  return typed.every((tool, index) => tool === tools[index])
    ? undefined
    : { ...request, tools: typed };
}
