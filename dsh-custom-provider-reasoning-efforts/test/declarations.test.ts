import { describe, expect, it } from "vitest";

import {
  DeclarationError,
  describeEfforts,
  validateDeclarations,
  validateInputs,
  validateModelDeclaration,
  validateModelInput,
} from "../declarations.ts";

describe("validateModelDeclaration", () => {
  it("accepts off with no wire value beside a thinking level", () => {
    expect(validateModelDeclaration("magpie", "x", { off: null, low: "low" })).toEqual({
      off: null,
      low: "low",
    });
  });

  it("rejects a non-object declaration", () => {
    expect(() => validateModelDeclaration("magpie", "x", "low")).toThrow(DeclarationError);
  });

  it("rejects a declaration that offers only off", () => {
    expect(() => validateModelDeclaration("magpie", "x", { off: null })).toThrow(
      /offers no level beyond "off"/,
    );
  });

  it("rejects a null wire value on a thinking level", () => {
    expect(() => validateModelDeclaration("magpie", "x", { high: null })).toThrow(
      /only "off" may stay empty/,
    );
  });

  it("rejects an empty wire spelling", () => {
    expect(() => validateModelDeclaration("magpie", "x", { high: "" })).toThrow(
      /must be a non-empty string/,
    );
  });

  it("rejects a level pi-ai does not know", () => {
    expect(() => validateModelDeclaration("magpie", "x", { ultra: "ultra" })).toThrow(
      /"ultra" is not a pi-ai thinking level/,
    );
  });

  it("names the route and the model in its rejection", () => {
    expect(() => validateModelDeclaration("magpie", "ollama-cloud/x", {})).toThrow(
      /route "magpie" model "ollama-cloud\/x"/,
    );
  });
});

describe("validateDeclarations", () => {
  it("accepts an empty table", () => {
    expect(validateDeclarations(undefined)).toEqual({});
  });

  it("validates every route and model", () => {
    const declarations = validateDeclarations({
      magpie: { a: { low: "low" }, b: false },
      other: { c: { medium: "medium" } },
    });
    expect(declarations).toEqual({
      magpie: { a: { low: "low" }, b: false },
      other: { c: { medium: "medium" } },
    });
  });

  it("rejects a route with no models", () => {
    expect(() => validateDeclarations({ magpie: {} })).toThrow(/declares no models/);
  });

  it("rejects an empty route name", () => {
    expect(() => validateDeclarations({ "": { a: { low: "low" } } })).toThrow(
      /empty provider route/,
    );
  });

  it("rejects an empty model id", () => {
    expect(() => validateDeclarations({ magpie: { "": { low: "low" } } })).toThrow(
      /empty model id/,
    );
  });
});

describe("validateModelInput", () => {
  it("accepts image before text as written", () => {
    expect(validateModelInput("magpie", "x", ["image", "text"])).toEqual(["image", "text"]);
  });

  it("rejects a non-array declaration", () => {
    expect(() => validateModelInput("magpie", "x", "text")).toThrow(/must be a modality array/);
  });

  it("rejects an array without text", () => {
    expect(() => validateModelInput("magpie", "x", ["image"])).toThrow(/missing "text"/);
  });
});

describe("validateInputs", () => {
  it("accepts an empty table", () => {
    expect(validateInputs(undefined)).toEqual({});
  });

  it("validates every route and model", () => {
    expect(validateInputs({ magpie: { a: ["text", "image"], b: ["text"] } })).toEqual({
      magpie: { a: ["text", "image"], b: ["text"] },
    });
  });

  it("rejects a route with no models", () => {
    expect(() => validateInputs({ magpie: {} })).toThrow(/declares no models in its vision table/);
  });

  it("rejects an empty route name", () => {
    expect(() => validateInputs({ "": { a: ["text"] } })).toThrow(/empty provider route/);
  });

  it("rejects an empty model id", () => {
    expect(() => validateInputs({ magpie: { "": ["text"] } })).toThrow(
      /vision table names an empty model id/,
    );
  });
});

describe("describeEfforts", () => {
  it("lists levels in escalation order", () => {
    expect(describeEfforts({ max: "max", low: "low", high: "high" })).toBe("low/high/max");
  });

  it("reports a non-reasoning model", () => {
    expect(describeEfforts(false)).toBe("no reasoning");
  });
});
