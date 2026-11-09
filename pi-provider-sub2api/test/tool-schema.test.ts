import { describe, expect, it } from "vitest";

import { withStringEnumTypes } from "../tool-schema.ts";

const STATUS = { enum: ["pending", "done"] };
const TYPED_STATUS = { type: "string", enum: ["pending", "done"] };

describe("withStringEnumTypes", () => {
  it("types a string enum wherever a schema can nest one", () => {
    expect(
      withStringEnumTypes({
        type: "object",
        properties: { status: STATUS },
        patternProperties: { "^x-": STATUS },
        additionalProperties: STATUS,
        $defs: { status: STATUS },
        items: [STATUS],
        anyOf: [STATUS, { type: "array", items: STATUS }],
      }),
    ).toEqual({
      type: "object",
      properties: { status: TYPED_STATUS },
      patternProperties: { "^x-": TYPED_STATUS },
      additionalProperties: TYPED_STATUS,
      $defs: { status: TYPED_STATUS },
      items: [TYPED_STATUS],
      anyOf: [TYPED_STATUS, { type: "array", items: TYPED_STATUS }],
    });
  });

  it.each([
    ["an existing type", { type: ["string", "null"], enum: ["a"] }],
    ["a numeric enum", { enum: [1, 2] }],
    ["a boolean enum", { enum: [true, false] }],
    ["a mixed enum", { enum: ["a", 1] }],
    ["a nullable enum", { enum: ["a", null] }],
    ["an empty enum", { enum: [] }],
  ])("leaves %s as it is", (_label, schema) => {
    expect(withStringEnumTypes(schema)).toBe(schema);
  });

  it("reads property names and values as data, not as schema keywords", () => {
    const schema = {
      type: "object",
      properties: {
        // A property called `enum` is not the keyword, and its map is not a schema.
        enum: { type: "string" },
        properties: { type: "object" },
      },
      // Neither is a value that happens to look like a schema.
      default: { enum: ["a"] },
      const: { enum: ["a"] },
      examples: [{ enum: ["a"] }],
    };
    expect(withStringEnumTypes(schema)).toBe(schema);
  });

  it("does not change the schema it was given, which Pi reuses for later requests", () => {
    const schema = { type: "object", properties: { status: { enum: ["a"] } } };
    const before = structuredClone(schema);
    withStringEnumTypes(schema);
    expect(schema).toEqual(before);
  });
});
