import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  nativeAutoEnabled,
  nativePolicy,
  nativeRetainTokens,
  object,
  parseLimit,
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

  it("validates the optional deployment default", () => {
    expect(validateDefaultLimit(undefined)).toBeUndefined();
    expect(validateDefaultLimit(300000)).toBe(300000);
    expect(() => validateDefaultLimit(0)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit(-1)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit(1.5)).toThrow(/defaultLimit/);
    expect(() => validateDefaultLimit("300k")).toThrow(/defaultLimit/);
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
