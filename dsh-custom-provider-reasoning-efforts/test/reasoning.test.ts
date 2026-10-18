import { describe, expect, it } from "vitest";

import { effortsOf, modalitiesOf, readManifestListing, readModelListing } from "../reasoning.ts";

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

describe("listing metadata", () => {
  it("reads the Harness probe's context and output spellings", () => {
    const models = readModelListing({
      data: [
        {
          id: "a",
          display_name: "Model A",
          context_window: 500000,
          max_output_tokens: 131072,
        },
        { id: "b", context_length: 1000000, max_tokens: 8192 },
        { id: "c", limit: { context: 128000, output: 16384 } },
      ],
    });
    expect(models).toEqual([
      { id: "a", name: "Model A", contextWindow: 500000, maxTokens: 131072 },
      { id: "b", contextWindow: 1000000, maxTokens: 8192 },
      { id: "c", contextWindow: 128000, maxTokens: 16384 },
    ]);
  });

  it("ignores capacities that are not positive integers", () => {
    expect(readModelListing({ data: [{ id: "a", context_window: 0, max_tokens: 1.5 }] })).toEqual([
      { id: "a" },
    ]);
  });

  it("reads the Codex manifest's display name and context window", () => {
    expect(
      readManifestListing({
        models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", context_window: 500000 }],
      }),
    ).toEqual([{ id: "gpt-6.1-sol", name: "GPT-6.1-Sol", contextWindow: 500000 }]);
  });
});

describe("modalitiesOf", () => {
  it("reads the OpenRouter architecture shape", () => {
    expect(modalitiesOf({ architecture: { input_modalities: ["text", "image"] } })).toEqual([
      "text",
      "image",
    ]);
  });

  it("reads a top-level input_modalities array", () => {
    expect(modalitiesOf({ input_modalities: ["text", "image"] })).toEqual(["text", "image"]);
  });

  it("reads supported_input_modalities", () => {
    expect(modalitiesOf({ supported_input_modalities: ["text"] })).toEqual(["text"]);
  });

  it("splits a joined modality spelling", () => {
    expect(modalitiesOf({ architecture: { modality: "text+image->text" } })).toEqual([
      "text",
      "image",
      "text",
    ]);
  });

  it("reads the nested modalities.input shape", () => {
    expect(modalitiesOf({ modalities: { input: ["text", "image"] } })).toEqual(["text", "image"]);
  });

  it("reads a top-level modalities array", () => {
    expect(modalitiesOf({ modalities: ["text", "image"] })).toEqual(["text", "image"]);
  });

  it("reads a text-only nested modalities.input", () => {
    expect(modalitiesOf({ modalities: { input: ["text"] } })).toEqual(["text"]);
  });

  it("maps the input- prefixed spellings", () => {
    expect(modalitiesOf({ input_modalities: ["input-text", "input-image"] })).toEqual([
      "text",
      "image",
    ]);
  });

  it("drops a member outside the vocabulary", () => {
    expect(modalitiesOf({ input_modalities: ["text", "audio"] })).toEqual(["text"]);
  });

  it("produces nothing when every member is outside the vocabulary", () => {
    expect(modalitiesOf({ input_modalities: ["video", "audio"] })).toBeUndefined();
  });

  it("produces nothing for a text-only model", () => {
    expect(modalitiesOf({ input_modalities: ["text"] })).toEqual(["text"]);
  });

  it("produces nothing for an entry with no modality fields", () => {
    expect(modalitiesOf({ id: "x" })).toBeUndefined();
  });

  it("ignores a non-array modality field", () => {
    expect(modalitiesOf({ input_modalities: 42 })).toBeUndefined();
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

  it("keeps a model's published modalities beside its levels", () => {
    const models = readModelListing({
      data: [
        {
          id: "vision-model",
          supported_reasoning_levels: [{ effort: "low" }],
          architecture: { input_modalities: ["text", "image"] },
        },
        { id: "text-model", input_modalities: ["text"] },
      ],
    });
    expect(models).toEqual([
      {
        id: "vision-model",
        efforts: { low: "low" },
        inputModalities: ["text", "image"],
      },
      { id: "text-model", inputModalities: ["text"] },
    ]);
  });

  it("rejects a reply that is not a listing", () => {
    expect(() => readModelListing({ object: "list" })).toThrow(
      /"data" array nor a "models" object/,
    );
    expect(() => readModelListing("nope")).toThrow(/not a JSON object/);
  });
});
