/**
 * ModelTrace fingerprint core.
 *
 * TypeScript port of `fingerprint-core.mjs` / `fingerprint.py` from
 * https://github.com/xqy2006/ModelTrace (MIT License, Copyright (c) 2026 xqy2006).
 *
 * All models share one global feature space:
 *   0.75 * nuisance-projected Hellinger centroid similarity
 * + 0.25 * ordered-block digit-sequence feature
 * Scores from each valid answer are averaged and converted to closed-set
 * probabilities through a per-query-count calibration temperature.
 */

export const VALUE_MIN = 1;
export const VALUE_MAX = 355;
export const DIMENSION = VALUE_MAX - VALUE_MIN + 1;
export const ALPHA = 0.5;

export interface BankModel {
  id: string;
  display_name: string;
  family?: string;
  family_name?: string;
  counts: number[];
}

export interface FingerprintBank {
  models: BankModel[];
  robust: {
    model_order: string[];
    hellinger: {
      feature_mean: number[];
      feature_scale: number[];
      nuisance_basis: number[][];
      centroids: number[][];
    };
    ordered_blocks?: {
      weight: number;
      feature_mean: number[];
      feature_scale: number[];
      nuisance_basis: number[][];
      centroids: number[][];
      environment_centroids: number[][][];
    };
  };
  calibration: Record<
    string,
    {
      beta: number;
      cv_accuracy: number;
      cv_correct?: number;
      cv_samples?: number;
      fallback?: boolean;
    }
  >;
  method?: { name?: string };
}

export interface ModelTraceOutput {
  text: string;
  expected_count?: number;
}

export interface ModelScore {
  model: string;
  display_name: string;
  probability: number;
  profile_similarity: number;
  score: number;
  family: string;
  family_name: string;
  conditional_probability: number;
}

export interface AnalysisResult {
  prediction: string;
  prediction_name: string;
  probability: number;
  used_outputs: number;
  results: ModelScore[];
  diagnostics: Array<{
    index: number;
    parsed_numbers: number;
    minimum_numbers: number;
    accepted: boolean;
  }>;
  calibration: { queries: string; beta: number; cv_accuracy: number };
  family_prediction: string;
  family_prediction_name: string;
  family_probability: number;
  family_probabilities: Array<{ family: string; display_name: string; probability: number }>;
  method: string;
}

/**
 * Extract the longest run of in-range integers from free text.
 * A letter in the separator between two digits starts a new run, which keeps
 * prose numbers ("generate 300 integers") out of the sampled sequence.
 */
export function parseNumbers(text: string): number[] {
  const runs: number[][] = [];
  let current: number[] = [];
  let previousEnd = 0;
  for (const match of String(text).matchAll(/\d+/g)) {
    const separator = String(text).slice(previousEnd, match.index);
    const value = Number(match[0]);
    if (current.length && /\p{L}/u.test(separator)) {
      runs.push(current);
      current = [];
    }
    if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value);
    previousEnd = match.index! + match[0].length;
  }
  if (current.length) runs.push(current);
  return runs.reduce((best, run) => (run.length > best.length ? run : best), []);
}

export function countNumbers(numbers: readonly number[]): number[] {
  const counts = Array(DIMENSION).fill(0) as number[];
  for (const number of numbers) counts[number - VALUE_MIN] += 1;
  return counts;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardize(values: readonly number[]): number[] {
  const center = mean(values);
  const variance = mean(values.map((value) => (value - center) ** 2));
  const scale = Math.max(Math.sqrt(variance), 1e-12);
  return values.map((value) => (value - center) / scale);
}

function dot(left: readonly number[], right: readonly number[]): number {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function norm(values: readonly number[]): number {
  return Math.sqrt(dot(values, values));
}

function normalized(values: readonly number[]): number[] {
  const scale = Math.max(norm(values), 1e-12);
  return values.map((value) => value / scale);
}

function subtractBasis(
  values: readonly number[],
  basis: readonly number[][] | undefined,
): number[] {
  const output = values.slice();
  for (const vector of basis ?? []) {
    const projection = dot(output, vector);
    for (let index = 0; index < output.length; index += 1)
      output[index] -= projection * vector[index];
  }
  return output;
}

function hellingerFeature(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
  return counts.map((value) => Math.sqrt((value + ALPHA) / total));
}

function splitIntoFour(values: readonly number[]): number[][] {
  const base = Math.floor(values.length / 4);
  const remainder = values.length % 4;
  const chunks: number[][] = [];
  let start = 0;
  for (let index = 0; index < 4; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    chunks.push(values.slice(start, start + size));
    start += size;
  }
  return chunks;
}

function orderedBlockFeature(numbers: readonly number[]): number[] {
  const pieces: number[] = [];
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5) as number[];
    for (const value of chunk) {
      const index = Math.min(15, Math.floor(((value - 1) / 355) * 16));
      bins[index] += 1;
    }
    const total = bins.reduce((sum, value) => sum + value, 0);
    pieces.push(...bins.map((value) => Math.sqrt(value / total)));
  }
  const lastDigits = Array(10).fill(0.5) as number[];
  for (const value of numbers) lastDigits[value % 10] += 1;
  const lastTotal = lastDigits.reduce((sum, value) => sum + value, 0);
  pieces.push(...lastDigits.map((value) => Math.sqrt(value / lastTotal)));
  return pieces;
}

function robustScoreCounts(counts: readonly number[], bank: FingerprintBank): number[] {
  const artifact = bank.robust.hellinger;
  const feature = hellingerFeature(counts);
  let projected = feature.map(
    (value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index],
  );
  projected = subtractBasis(projected, artifact.nuisance_basis);
  projected = normalized(projected);
  const scores = artifact.centroids.map((centroid) => dot(projected, centroid));
  return standardize(scores);
}

function orderedBlockScores(numbers: readonly number[], bank: FingerprintBank): number[] {
  const artifact = bank.robust.ordered_blocks!;
  const feature = orderedBlockFeature(numbers);
  const standardizedFeature = feature.map(
    (value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index],
  );
  const unit = normalized(standardizedFeature);
  const environmentScores = artifact.environment_centroids.map((centroids) =>
    centroids.map((centroid) => dot(unit, centroid)),
  );
  const template = standardize(
    artifact.centroids.map((_, modelIndex) =>
      Math.max(...environmentScores.map((scores) => scores[modelIndex])),
    ),
  );
  const projected = normalized(subtractBasis(standardizedFeature, artifact.nuisance_basis));
  const nuisance = standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
  return standardize(template.map((value, index) => 0.5 * value + 0.5 * nuisance[index]));
}

function robustScoreNumbers(numbers: readonly number[], bank: FingerprintBank): number[] {
  const marginal = robustScoreCounts(countNumbers(numbers), bank);
  const artifact = bank.robust.ordered_blocks;
  const weight = artifact ? Number(artifact.weight || 0) : 0;
  if (!artifact || weight === 0) return marginal;
  const ordered = orderedBlockScores(numbers, bank);
  return marginal.map((value, index) => (1 - weight) * value + weight * ordered[index]);
}

function softmax(values: readonly number[]): number[] {
  const maximum = Math.max(...values);
  const weights = values.map((value) => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function jsSimilarity(left: readonly number[], right: readonly number[]): number {
  const leftTotal = left.reduce((sum, value) => sum + value, 0);
  const rightTotal = right.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
  const p = left.map((value) => value / leftTotal);
  const q = right.map((value) => (value + ALPHA) / rightTotal);
  const midpoint = p.map((value, index) => (value + q[index]) / 2);
  const divergence = (values: readonly number[]) =>
    values.reduce(
      (total, value, index) => total + (value ? value * Math.log(value / midpoint[index]) : 0),
      0,
    );
  const js = (divergence(p) + divergence(q)) / 2;
  return 1 - Math.sqrt(js / Math.log(2));
}

/**
 * Score a list of raw probe outputs against the unified bank.
 * Throws when no output contains enough parseable numbers.
 */
export function analyzeGlobalOutputs(
  outputs: ModelTraceOutput[],
  bank: FingerprintBank,
): AnalysisResult {
  const modelIds = bank.models.map((model) => model.id);
  const valid: Array<{ counts: number[]; scores: number[] }> = [];
  const diagnostics: AnalysisResult["diagnostics"] = [];
  outputs.forEach((item, index) => {
    const expected = Number(item.expected_count || 0);
    const numbers = parseNumbers(item.text || "");
    const minimum = expected ? Math.max(80, Math.ceil(expected * 0.55)) : 80;
    const accepted = numbers.length >= minimum;
    diagnostics.push({ index, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted });
    if (accepted)
      valid.push({ counts: countNumbers(numbers), scores: robustScoreNumbers(numbers, bank) });
  });
  if (!valid.length)
    throw new Error("没有可用回答：请粘贴完整数字序列；拒答或严重截断的回答不会计入。");

  const combinedScores = modelIds.map((_, modelIndex) =>
    mean(valid.map((item) => item.scores[modelIndex])),
  );
  const calibrationKey = String(Math.min(valid.length, 3));
  const beta = Number(bank.calibration[calibrationKey].beta);
  const probabilities = softmax(combinedScores.map((value) => beta * value));
  const pooledCounts = Array.from({ length: DIMENSION }, (_, index) =>
    valid.reduce((sum, item) => sum + item.counts[index], 0),
  );
  const modelEntries = Object.fromEntries(bank.models.map((model) => [model.id, model]));
  const familyOrder = [...new Set(bank.models.map((model) => model.family || "models"))];
  const familyNames = Object.fromEntries(
    familyOrder.map((family) => [
      family,
      bank.models.find((model) => (model.family || "models") === family)?.family_name || family,
    ]),
  );
  const results: ModelScore[] = modelIds
    .map((model, index) => ({
      model,
      display_name: modelEntries[model].display_name,
      probability: probabilities[index],
      profile_similarity: jsSimilarity(pooledCounts, modelEntries[model].counts),
      score: combinedScores[index],
      family: modelEntries[model].family || "models",
      family_name: familyNames[modelEntries[model].family || "models"],
      conditional_probability: 0,
    }))
    .sort((left, right) => right.probability - left.probability);
  const familyProbabilities = Object.fromEntries(
    familyOrder.map((family) => [
      family,
      results
        .filter((item) => item.family === family)
        .reduce((sum, item) => sum + item.probability, 0),
    ]),
  );
  for (const item of results) {
    item.conditional_probability = item.probability / familyProbabilities[item.family];
  }
  const winningFamily = familyOrder.reduce((best, family) =>
    familyProbabilities[family] > familyProbabilities[best] ? family : best,
  );
  return {
    prediction: results[0].model,
    prediction_name: results[0].display_name,
    probability: results[0].probability,
    used_outputs: valid.length,
    results,
    diagnostics,
    calibration: {
      queries: calibrationKey,
      beta,
      cv_accuracy: bank.calibration[calibrationKey].cv_accuracy,
    },
    family_prediction: winningFamily,
    family_prediction_name: familyNames[winningFamily],
    family_probability: familyProbabilities[winningFamily],
    family_probabilities: familyOrder.map((family) => ({
      family,
      display_name: familyNames[family],
      probability: familyProbabilities[family],
    })),
    method: "统一全局稳健数字指纹",
  };
}
