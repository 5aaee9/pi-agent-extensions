import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  effectiveCompaction,
  parseLimit,
  readSettings,
  supportsBoundaries,
  validateLimit,
} from "../settings.ts";

const key = "provider/model";

describe("thresholds", () => {
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
  it("validates model and retained-context bounds", () => {
    expect(() => validateLimit(300000, 1000000, 20000)).not.toThrow();
    expect(() => validateLimit(20000, 1000000, 20000)).toThrow(/keepRecentTokens/);
    expect(() => validateLimit(1000000, 1000000, 20000)).toThrow(/context window/);
  });
  it("requires the actionable-boundary host version", () => {
    expect(supportsBoundaries("0.84.0")).toBe(false);
    expect(supportsBoundaries("0.87.0")).toBe(false);
    expect(supportsBoundaries("0.87.1")).toBe(true);
    expect(supportsBoundaries("1.0.0")).toBe(true);
  });
});

describe("read-only configuration", () => {
  it("loads optional global model defaults", () => {
    expect(defaultLimits({}).size).toBe(0);
    expect(defaultLimits({ piAutocompact: { modelLimits: { [key]: 300000 } } }).get(key)).toBe(
      300000,
    );
    expect(() => defaultLimits({ piAutocompact: { modelLimits: { [key]: "300k" } } })).toThrow(
      /Invalid/,
    );
  });
  it("resolves native per-model settings without altering them", () => {
    const global = {
      compaction: { reserveTokens: 10000, modelOverrides: { [key]: { reserveTokens: 40000 } } },
    };
    const project = { compaction: { reserveTokens: 5000, keepRecentTokens: 25000 } };
    expect(effectiveCompaction(global, project, key)).toEqual({
      enabled: true,
      reserveTokens: 40000,
      keepRecentTokens: 25000,
    });
    expect(effectiveCompaction(global, { compaction: { enabled: false } }, key).enabled).toBe(
      false,
    );
    expect(global.compaction.reserveTokens).toBe(10000);
  });
  it("does not create missing settings or overwrite malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "settings.json");
    try {
      expect(await readSettings(path)).toEqual({});
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(path, "{bad");
      await expect(readSettings(path)).rejects.toThrow(/JSON/);
      expect(await readFile(path, "utf8")).toBe("{bad");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
