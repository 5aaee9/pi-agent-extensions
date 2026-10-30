import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SettingsManager, VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

let agentDir: string;
let projectDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-autocompact-agent-"));
  projectDir = await mkdtemp(join(tmpdir(), "pi-autocompact-project-"));
});

afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

function globalSettingsPath(): string {
  return join(agentDir, "settings.json");
}

function projectSettingsPath(): string {
  return join(projectDir, ".pi", "settings.json");
}

async function writeSettings(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

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
    // The package's supported boundary path matches the pinned host it loads with.
    expect(supportsBoundaries(VERSION)).toBe(true);
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
  it("merges one model key and leaves the input unchanged", async () => {
    const input = {
      compaction: { enabled: true },
      piAutocompact: { note: "keep", modelLimits: { "other/model": 1000 } },
    };
    await writeSettings(globalSettingsPath(), input);
    const bytes = await readFile(globalSettingsPath(), "utf8");
    const stored = await readSettings(globalSettingsPath());

    const next = withModelLimit(stored, key, 300000);
    expect(next).toEqual({
      compaction: { enabled: true },
      piAutocompact: {
        note: "keep",
        modelLimits: { "other/model": 1000, [key]: 300000 },
      },
    });
    expect(await readFile(globalSettingsPath(), "utf8")).toBe(bytes);
    expect((await readSettings(globalSettingsPath())).piAutocompact).toEqual({
      note: "keep",
      modelLimits: { "other/model": 1000 },
    });

    await writeSettings(globalSettingsPath(), next);
    expect(defaultLimits(await readSettings(globalSettingsPath())).get(key)).toBe(300000);
    expect(() => withModelLimit(next, "model", 300000)).toThrow(/model key/);

    await writeSettings(globalSettingsPath(), { piAutocompact: { modelLimits: [] } });
    const invalid = await readSettings(globalSettingsPath());
    expect(() => withModelLimit(invalid, key, 300000)).toThrow(/modelLimits/);
  });

  it("creates a missing file and updates one key on a later save", async () => {
    const path = globalSettingsPath();
    await saveModelLimit(path, key, 300000);
    expect(await readSettings(path)).toEqual({
      piAutocompact: { modelLimits: { [key]: 300000 } },
    });
    // Pi's own settings reader sees the file the package wrote.
    expect(SettingsManager.create(projectDir, agentDir).getGlobalSettings()).toEqual({
      piAutocompact: { modelLimits: { [key]: 300000 } },
    });
    await expect(stat(`${resolve(path)}.lock`)).rejects.toMatchObject({ code: "ENOENT" });

    await saveModelLimit(path, "other/model", 120000);
    expect(await readSettings(path)).toEqual({
      piAutocompact: { modelLimits: { [key]: 300000, "other/model": 120000 } },
    });
  });

  it("preserves unrelated settings and the existing file mode", async () => {
    const path = globalSettingsPath();
    const project = projectSettingsPath();
    await writeFile(path, `${JSON.stringify({ theme: "dark", compaction: { enabled: true } })}\n`, {
      mode: 0o600,
    });
    await mkdir(dirname(project), { recursive: true });
    await writeFile(project, "{}\n");

    await saveModelLimit(path, key, 300000);
    expect(await readSettings(path)).toEqual({
      theme: "dark",
      compaction: { enabled: true },
      piAutocompact: { modelLimits: { [key]: 300000 } },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(project, "utf8")).toBe("{}\n");
  });

  it("does not replace malformed JSON or a non-object model map", async () => {
    const path = globalSettingsPath();
    await writeFile(path, "{bad");
    await expect(saveModelLimit(path, key, 300000)).rejects.toThrow(/JSON/);
    expect(await readFile(path, "utf8")).toBe("{bad");

    const invalid = JSON.stringify({ piAutocompact: { modelLimits: [] } });
    await writeFile(path, invalid);
    await expect(saveModelLimit(path, key, 300000)).rejects.toThrow(/modelLimits/);
    expect(await readFile(path, "utf8")).toBe(invalid);
    await expect(stat(`${resolve(path)}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces a stale lock and refuses a lock another writer still holds", async () => {
    const path = join(agentDir, "nested", "settings.json");
    const lock = `${resolve(path)}.lock`;
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
  });

  it("keeps both keys when two saves overlap", async () => {
    const path = globalSettingsPath();
    await Promise.all([saveModelLimit(path, "a/one", 1000), saveModelLimit(path, "b/two", 2000)]);
    expect(defaultLimits(await readSettings(path))).toEqual(
      new Map([
        ["a/one", 1000],
        ["b/two", 2000],
      ]),
    );
  });
});

describe("read-only configuration", () => {
  it("loads optional global model defaults", async () => {
    expect(defaultLimits(await readSettings(join(agentDir, "absent.json"))).size).toBe(0);

    await writeSettings(globalSettingsPath(), {
      piAutocompact: { modelLimits: { [key]: 300000 } },
    });
    expect(defaultLimits(await readSettings(globalSettingsPath())).get(key)).toBe(300000);

    await writeSettings(globalSettingsPath(), {
      piAutocompact: { modelLimits: { [key]: "300k" } },
    });
    const invalid = await readSettings(globalSettingsPath());
    expect(() => defaultLimits(invalid)).toThrow(/Invalid/);
  });

  it("resolves native per-model settings without altering them", async () => {
    await writeSettings(globalSettingsPath(), {
      compaction: {
        reserveTokens: 10000,
        modelOverrides: { [key]: { reserveTokens: 40000 } },
      },
    });
    await writeSettings(projectSettingsPath(), {
      compaction: { reserveTokens: 5000, keepRecentTokens: 25000 },
    });
    const bytes = await readFile(globalSettingsPath(), "utf8");

    expect(
      effectiveCompaction(
        await readSettings(globalSettingsPath()),
        await readSettings(projectSettingsPath()),
        key,
      ),
    ).toEqual({ enabled: true, reserveTokens: 40000, keepRecentTokens: 25000 });
    expect(await readFile(globalSettingsPath(), "utf8")).toBe(bytes);

    await writeSettings(projectSettingsPath(), { compaction: { enabled: false } });
    expect(
      effectiveCompaction(
        await readSettings(globalSettingsPath()),
        await readSettings(projectSettingsPath()),
        key,
      ).enabled,
    ).toBe(false);
  });

  it("does not create missing settings or overwrite malformed JSON", async () => {
    const path = join(agentDir, "settings.json");
    expect(await readSettings(path)).toEqual({});
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(path, "{bad");
    await expect(readSettings(path)).rejects.toThrow(/JSON/);
    expect(await readFile(path, "utf8")).toBe("{bad");
  });
});
