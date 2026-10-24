import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  effectiveCompaction,
  parseAutocompactCommand,
  parseLimit,
  readSettings,
  saveModelLimit,
  supportsBoundaries,
  validateLimit,
  withModelLimit,
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

describe("command arguments", () => {
  it.each([
    ["300k", 300000, false],
    ["  0.3M  ", 300000, false],
    ["300000", 300000, false],
    ["300k --save", 300000, true],
    ["--save 300k", 300000, true],
    ["--SAVE 1m", 1000000, true],
  ])("parses %j", (input, tokens, save) => {
    expect(parseAutocompactCommand(input)).toEqual({ kind: "limit", tokens, save });
  });
  it.each(["", "   "])("treats %j as status", (input) => {
    expect(parseAutocompactCommand(input)).toEqual({ kind: "status" });
  });
  it.each(["off", "OFF", "default"])("parses %s without saving", (input) => {
    expect(parseAutocompactCommand(input)).toEqual({ kind: input.toLowerCase() });
  });
  it.each([
    "off --save",
    "--save off",
    "default --save",
    "--save default",
    "--save",
    "--save --save",
    "300k --save extra",
    "300k --save --save",
    "--bogus 300k",
    "300k extra",
  ])("rejects %j", (input) => {
    expect(() => parseAutocompactCommand(input)).toThrow(/--save|Usage|Unknown option/);
  });
});

describe("saved model limits", () => {
  it("merges one model key and leaves the input unchanged", () => {
    const input = {
      compaction: { enabled: true },
      piAutocompact: { note: "keep", modelLimits: { "other/model": 1000 } },
    };
    const next = withModelLimit(input, key, 300000);
    expect(next).toEqual({
      compaction: { enabled: true },
      piAutocompact: {
        note: "keep",
        modelLimits: { "other/model": 1000, [key]: 300000 },
      },
    });
    expect(input.piAutocompact.modelLimits).toEqual({ "other/model": 1000 });
    expect(defaultLimits(next).get(key)).toBe(300000);
    expect(() => withModelLimit(input, "model", 300000)).toThrow(/model key/);
    expect(() => withModelLimit({ piAutocompact: { modelLimits: [] } }, key, 300000)).toThrow(
      /modelLimits/,
    );
  });

  it("creates a missing file and updates one key on a later save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "settings.json");
    try {
      await saveModelLimit(path, key, 300000);
      expect(await readSettings(path)).toEqual({
        piAutocompact: { modelLimits: { [key]: 300000 } },
      });
      await expect(stat(`${resolve(path)}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
      await saveModelLimit(path, "other/model", 120000);
      expect(await readSettings(path)).toEqual({
        piAutocompact: { modelLimits: { [key]: 300000, "other/model": 120000 } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves unrelated settings and the existing file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "settings.json");
    const project = join(dir, "project.json");
    try {
      await writeFile(
        path,
        `${JSON.stringify({ theme: "dark", compaction: { enabled: true } })}\n`,
        { mode: 0o600 },
      );
      await writeFile(project, "{}\n");
      await saveModelLimit(path, key, 300000);
      expect(await readSettings(path)).toEqual({
        theme: "dark",
        compaction: { enabled: true },
        piAutocompact: { modelLimits: { [key]: 300000 } },
      });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readFile(project, "utf8")).toBe("{}\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not replace malformed JSON or a non-object model map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "settings.json");
    try {
      await writeFile(path, "{bad");
      await expect(saveModelLimit(path, key, 300000)).rejects.toThrow(/JSON/);
      expect(await readFile(path, "utf8")).toBe("{bad");
      const invalid = JSON.stringify({ piAutocompact: { modelLimits: [] } });
      await writeFile(path, invalid);
      await expect(saveModelLimit(path, key, 300000)).rejects.toThrow(/modelLimits/);
      expect(await readFile(path, "utf8")).toBe(invalid);
      await expect(stat(`${resolve(path)}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces a stale lock and refuses a lock another writer still holds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "nested", "settings.json");
    const lock = `${resolve(path)}.lock`;
    try {
      await mkdir(lock, { recursive: true });
      const stale = new Date(Date.now() - 20_000);
      await utimes(lock, stale, stale);
      await saveModelLimit(path, key, 300000);
      expect(await readSettings(path)).toEqual({
        piAutocompact: { modelLimits: { [key]: 300000 } },
      });

      await mkdir(lock);
      await expect(saveModelLimit(path, "other/model", 1000)).rejects.toThrow(/locked/);
      expect(await readSettings(path)).toEqual({
        piAutocompact: { modelLimits: { [key]: 300000 } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps both keys when two saves overlap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-autocompact-"));
    const path = join(dir, "settings.json");
    try {
      await Promise.all([saveModelLimit(path, "a/one", 1000), saveModelLimit(path, "b/two", 2000)]);
      expect(defaultLimits(await readSettings(path))).toEqual(
        new Map([
          ["a/one", 1000],
          ["b/two", 2000],
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
