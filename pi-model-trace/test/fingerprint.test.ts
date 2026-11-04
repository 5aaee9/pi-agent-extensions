import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  analyzeGlobalOutputs,
  countNumbers,
  DIMENSION,
  parseNumbers,
  type FingerprintBank,
} from "../fingerprint.ts";

const bank = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/unified_bank.json", import.meta.url)), "utf8"),
) as FingerprintBank;

/** Deterministic generator (mulberry32), so a failure reproduces. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws in-range numbers with the frequencies a bank model's count vector records. */
function sampleFromCounts(counts: readonly number[], size: number, next: () => number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return Array.from({ length: size }, () => {
    let remaining = next() * total;
    const index = counts.findIndex((count) => (remaining -= count) < 0);
    return (index === -1 ? counts.length - 1 : index) + 1;
  });
}

describe("parseNumbers", () => {
  it("drops out-of-range values without breaking the run", () => {
    expect(parseNumbers("5, 999, 6, 0, 7")).toEqual([5, 6, 7]);
  });

  it("splits runs on letters between numbers and keeps the longest", () => {
    expect(parseNumbers("1,2,3 then output 10,20,30,40")).toEqual([10, 20, 30, 40]);
  });

  it("keeps prose numbers out of the sampled sequence", () => {
    const sequence = Array.from({ length: 120 }, (_, index) => index + 1);
    const text = `生成 ${sequence.length} 个数字: ${sequence.join(", ")}`;
    expect(parseNumbers(text)).toEqual(sequence);
  });
});

describe("countNumbers", () => {
  it("builds a 355-dimension count vector", () => {
    const counts = countNumbers([1, 355, 355]);
    expect(counts).toHaveLength(DIMENSION);
    expect(counts[0]).toBe(1);
    expect(counts[354]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("analyzeGlobalOutputs", () => {
  it("rejects outputs without enough numbers", () => {
    expect(() => analyzeGlobalOutputs([{ text: "1,2,3" }], bank)).toThrow(/没有可用回答/);
  });

  it("attributes a sample of each bank model's own counts to that model", () => {
    const misattributed = bank.models.flatMap((model, modelIndex) => {
      const next = seededRandom(modelIndex + 1);
      const outputs = Array.from({ length: 3 }, () => ({
        expected_count: 300,
        text: sampleFromCounts(model.counts, 300, next).join(", "),
      }));
      const result = analyzeGlobalOutputs(outputs, bank);
      expect(result.used_outputs).toBe(3);
      const total = result.results.reduce((sum, item) => sum + item.probability, 0);
      expect(total).toBeCloseTo(1, 6);
      return result.prediction === model.id ? [] : [`${model.id} -> ${result.prediction}`];
    });
    expect(misattributed).toEqual([]);
  });

  it("marks short outputs as invalid but still scores valid ones", () => {
    const long = Array.from({ length: 300 }, (_, index) => ((index * 37) % 355) + 1).join(" ");
    const result = analyzeGlobalOutputs(
      [
        { text: long, expected_count: 300 },
        { text: "I refuse", expected_count: 300 },
      ],
      bank,
    );
    expect(result.used_outputs).toBe(1);
    expect(result.diagnostics[1].accepted).toBe(false);
  });
});
