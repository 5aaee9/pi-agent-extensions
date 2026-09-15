import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateChallenges } from "../challenges.ts";
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

describe("parseNumbers", () => {
  it("parses comma and space separated runs", () => {
    expect(parseNumbers("1, 2, 3 355")).toEqual([1, 2, 3, 355]);
  });

  it("drops out-of-range values without breaking the run", () => {
    expect(parseNumbers("5, 999, 6, 0, 7")).toEqual([5, 6, 7]);
  });

  it("splits runs on letters between numbers and keeps the longest", () => {
    expect(parseNumbers("1,2,3 then output 10,20,30,40")).toEqual([10, 20, 30, 40]);
  });

  it("keeps prose numbers out of the sampled sequence", () => {
    const sequence = Array.from({ length: 120 }, (_, index) => (index % 355) + 1).join(", ");
    const text = `生成 ${sequence.length} 个数字: ${sequence}`;
    expect(parseNumbers(text)).toHaveLength(120);
  });

  it("returns an empty array for prose-only text", () => {
    expect(parseNumbers("no digits here")).toEqual([]);
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

describe("generateChallenges", () => {
  it("creates three challenges with distinct expected counts in range", () => {
    const challenges = generateChallenges();
    expect(challenges).toHaveLength(3);
    const counts = challenges.map((challenge) => challenge.expected_count);
    expect(new Set(counts).size).toBe(3);
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(292);
      expect(count).toBeLessThanOrEqual(332);
    }
    for (const challenge of challenges) {
      expect(challenge.id).toMatch(/^probe-\d+-[0-9a-f]{14}$/);
      expect(challenge.prompt).toContain("1 到 355");
      expect(challenge.prompt).toContain(String(challenge.expected_count));
    }
  });
});

describe("analyzeGlobalOutputs", () => {
  it("rejects outputs without enough numbers", () => {
    expect(() => analyzeGlobalOutputs([{ text: "1,2,3" }], bank)).toThrow(/没有可用回答/);
  });

  it("attributes a synthetic sequence to some model with normalized probabilities", () => {
    // Deterministic pseudo-random sequence; any closed-set result is fine.
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const outputs = Array.from({ length: 3 }, () => ({
      expected_count: 300,
      text: Array.from({ length: 300 }, () => (next() % 355) + 1).join(", "),
    }));
    const result = analyzeGlobalOutputs(outputs, bank);
    expect(result.used_outputs).toBe(3);
    expect(result.results).toHaveLength(bank.models.length);
    const total = result.results.reduce((sum, item) => sum + item.probability, 0);
    expect(total).toBeCloseTo(1, 6);
    const familyTotal = result.family_probabilities.reduce(
      (sum, item) => sum + item.probability,
      0,
    );
    expect(familyTotal).toBeCloseTo(1, 6);
    expect(result.results[0].model).toBe(result.prediction);
    expect(result.diagnostics).toHaveLength(3);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.accepted).toBe(true);
      expect(diagnostic.parsed_numbers).toBe(300);
    }
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
