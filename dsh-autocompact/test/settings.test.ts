import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  modelKey,
  nativeAutoEnabled,
  nativePolicy,
  nativeRetainTokens,
  object,
  parseLimit,
  resolveLimit,
  supportsRegions,
  validateDefaultLimit,
  validateLimit,
} from "../settings.ts";

const key = "provider/model";
const engine = { config: { auto: true, retainRatio: 0.16, retainTokens: 20000 } };

describe("threshold parsing and validation", () => {
  it.each([
    ["300k", 300000],
    ["0.3M", 300000],
    ["300000", 300000],
    ["1m", 1000000],
  ])("parses %s as decimal tokens", (text, expected) =>
    expect(parseLimit(String(text))).toBe(expected),
  );

  it.each(["0", "-1", "NaN", "1e6", "300kb", "300k extra", "0.1", "9007199254740992"])(
    "rejects %s",
    (text) => expect(() => parseLimit(text)).toThrow(/Usage|Threshold/),
  );

  it("validates the retained tail and the real context window", () => {
    expect(() => validateLimit(300000, 1000000, 20000)).not.toThrow();
    expect(() => validateLimit(20000, 1000000, 20000)).toThrow(/retained token budget/);
    expect(() => validateLimit(1000000, 1000000, 20000)).toThrow(/context window/);
    expect(() => validateLimit(300000, 0, 20000)).toThrow(/context window/);
  });
});

describe("configuration resolution", () => {
  it("rejects non-object configuration sections", () => {
    expect(object(undefined, "section")).toEqual({});
    expect(() => object([], "section")).toThrow(/must be an object/);
    expect(() => object("x", "section")).toThrow(/must be an object/);
  });

  it("loads optional global model defaults without writing them", () => {
    expect(defaultLimits({}).size).toBe(0);
    expect(defaultLimits({ modelLimits: { [key]: 300000 } }).get(key)).toBe(300000);
    expect(() => defaultLimits({ modelLimits: { nokey: 300000 } })).toThrow(/Invalid/);
    expect(() => defaultLimits({ modelLimits: { [key]: "300k" } })).toThrow(/Invalid/);
    expect(() => defaultLimits({ modelLimits: { [key]: 0 } })).toThrow(/Invalid/);
  });

  it("lets a session override win, including an explicit suppression", () => {
    const defaults = new Map([[key, 300000]]);
    expect(resolveLimit(new Map(), defaults, key)).toBe(300000);
    expect(resolveLimit(new Map([[key, 250000]]), defaults, key)).toBe(250000);
    expect(resolveLimit(new Map([[key, null]]), defaults, key)).toBeUndefined();
    expect(resolveLimit(new Map(), defaults, "other/model")).toBeUndefined();
  });

  it("validates the optional deployment default", () => {
    expect(validateDefaultLimit(undefined)).toBeUndefined();
    expect(validateDefaultLimit(300000)).toBe(300000);
    expect(() => validateDefaultLimit(0)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit(-1)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit(1.5)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit("300k")).toThrow(/defaultLimit/);
  });

  it("falls back to the deployment default only without a per-model entry", () => {
    const defaults = new Map([[key, 400000]]);
    // No per-model entry: the deployment default covers the route.
    expect(resolveLimit(new Map(), new Map(), key, 300000)).toBe(300000);
    expect(resolveLimit(new Map(), new Map(), "other/model", 300000)).toBe(300000);
    // A per-model entry or a session override wins over it.
    expect(resolveLimit(new Map(), defaults, key, 300000)).toBe(400000);
    expect(resolveLimit(new Map([[key, 250000]]), defaults, key, 300000)).toBe(250000);
    // An explicit off suppresses the default too.
    expect(resolveLimit(new Map([[key, null]]), defaults, key, 300000)).toBeUndefined();
    // No default configured: the route stays uncovered.
    expect(resolveLimit(new Map(), new Map(), key)).toBeUndefined();
  });

  it("builds exact route keys", () => {
    expect(modelKey("provider", "model")).toBe(key);
  });
});

describe("native backend introspection", () => {
  it("reads a published policy and defaults unknown backends to enabled", () => {
    expect(nativePolicy(engine)).toMatchObject({ auto: true });
    expect(nativePolicy({})).toBeUndefined();
    expect(nativePolicy(undefined)).toBeUndefined();
    expect(nativeAutoEnabled(engine)).toBe(true);
    expect(nativeAutoEnabled({ config: { auto: false } })).toBe(false);
    expect(nativeAutoEnabled({})).toBe(true);
  });

  it("detects the explicit region-compaction capability", () => {
    expect(supportsRegions({ compactRegion: () => {} })).toBe(true);
    expect(supportsRegions({})).toBe(false);
    expect(supportsRegions(undefined)).toBe(false);
  });

  it("resolves the retained tail exactly like the backend does", () => {
    const policy = {
      auto: true,
      retainRatio: 0.16,
      modelPolicies: [{ provider: "provider", model: "model", retainTokens: 4096 }],
    };
    expect(nativeRetainTokens(policy, "provider", "model", 1000000, 8000, 20000)).toBe(4096);
    expect(
      nativeRetainTokens({ retainTokens: 1234 }, "provider", "model", 1000000, 8000, 20000),
    ).toBe(1234);
    expect(nativeRetainTokens({ retainRatio: 0.16 }, "p", "m", 1000000, 0, 20000)).toBe(160000);
    expect(nativeRetainTokens({ retainRatio: 0.16 }, "p", "m", 1000, 0, 20000)).toBe(160);
    expect(nativeRetainTokens(undefined, "p", "m", 1000000, 0, 20000)).toBe(20000);
    expect(nativeRetainTokens({ retainRatio: 0.16 }, "p", "m", 1000, 1000, 20000)).toBe(20000);
  });
});
