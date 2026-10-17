import { describe, expect, it } from "vitest";

import {
  DeclarationError,
  describeEfforts,
  validateDeclarations,
  validateModelDeclaration,
} from "../declarations.ts";

describe("validateModelDeclaration", () => {
  it("accepts the levels the observed gateway advertises", () => {
    expect(
      validateModelDeclaration("magpie", "x", { low: "low", high: "high", max: "max" }),
    ).toEqual({ low: "low", high: "high", max: "max" });
  });

  it("accepts false for a model that cannot reason", () => {
    expect(validateModelDeclaration("magpie", "x", false)).toBe(false);
  });

  it("accepts off with no wire value beside a thinking level", () => {
    expect(validateModelDeclaration("magpie", "x", { off: null, low: "low" })).toEqual({
      off: null,
      low: "low",
    });
  });

  it("rejects a non-object declaration", () => {
    expect(() => validateModelDeclaration("magpie", "x", "low")).toThrow(DeclarationError);
  });

  it("rejects an empty declaration", () => {
    expect(() => validateModelDeclaration("magpie", "x", {})).toThrow(/is empty/);
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

describe("describeEfforts", () => {
  it("lists levels in escalation order", () => {
    expect(describeEfforts({ max: "max", low: "low", high: "high" })).toBe("low/high/max");
  });

  it("reports a non-reasoning model", () => {
    expect(describeEfforts(false)).toBe("no reasoning");
  });
});
