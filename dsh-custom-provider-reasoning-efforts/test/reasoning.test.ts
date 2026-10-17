import { describe, expect, it } from "vitest";

import { effortsOf, readModelListing } from "../reasoning.ts";

describe("effortsOf", () => {
  it("reads the levels the observed gateway advertises", () => {
    expect(
      effortsOf({
        reasoning: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
      }),
    ).toEqual({ low: "low", high: "high", max: "max" });
  });

  it("reads string level entries", () => {
    expect(effortsOf({ supported_reasoning_efforts: ["low", "medium"] })).toEqual({
      low: "low",
      medium: "medium",
    });
  });

  it("reads a reasoning object's efforts", () => {
    expect(effortsOf({ reasoning: { efforts: ["high"] } })).toEqual({ high: "high" });
  });

  it("reads a reasoning object's supported efforts with level objects", () => {
    expect(effortsOf({ reasoning: { supported_efforts: [{ level: "medium" }] } })).toEqual({
      medium: "medium",
    });
  });

  it("maps off to no wire value", () => {
    expect(effortsOf({ reasoning_levels: ["off", "high"] })).toEqual({ off: null, high: "high" });
  });

  it("ignores level names pi-ai does not know", () => {
    expect(effortsOf({ supported_reasoning_levels: ["turbo", "low"] })).toEqual({ low: "low" });
  });

  it("produces nothing for a capability with no levels", () => {
    expect(effortsOf({ reasoning: true })).toBeUndefined();
  });

  it("produces nothing when the entry says it cannot reason", () => {
    expect(
      effortsOf({ reasoning: false, supported_reasoning_levels: [{ effort: "low" }] }),
    ).toBeUndefined();
  });

  it("produces nothing for an entry with no reasoning fields", () => {
    expect(effortsOf({ id: "x" })).toBeUndefined();
  });
});

describe("readModelListing", () => {
  it("reads a data array in endpoint order", () => {
    const models = readModelListing({
      data: [
        { id: "a", reasoning: true, supported_reasoning_levels: [{ effort: "low" }] },
        { id: "b" },
      ],
    });
    expect(models).toEqual([{ id: "a", efforts: { low: "low" } }, { id: "b" }]);
  });

  it("reads a models map with the property key as the id", () => {
    const models = readModelListing({
      models: { "alias/a": { id: "canonical/a", reasoning_levels: ["high"] } },
    });
    expect(models).toEqual([{ id: "alias/a", efforts: { high: "high" } }]);
  });

  it("falls back to the nested id for an empty property key", () => {
    const models = readModelListing({ models: { "": { id: "fallback", reasoning: true } } });
    expect(models).toEqual([{ id: "fallback" }]);
  });

  it("skips entries without a usable id", () => {
    const models = readModelListing({ data: [{ name: "no id" }, { id: "kept" }] });
    expect(models).toEqual([{ id: "kept" }]);
  });

  it("rejects a reply that is not a listing", () => {
    expect(() => readModelListing({ object: "list" })).toThrow(
      /"data" array nor a "models" object/,
    );
    expect(() => readModelListing("nope")).toThrow(/not a JSON object/);
  });
});
