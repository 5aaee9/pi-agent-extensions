import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultLimits,
  effectiveCompaction,
  effectiveLimit,
  limitFromSettings,
  parseAutocompactCommand,
  parseLimit,
  readSettings,
  resolveLimit,
  saveLimit,
  unusableReason,
  validateLimit,
  type LimitValue,
  type SaveDestination,
} from "../settings.ts";

const key = "provider/model";
const tokens = (count: number): LimitValue => ({ kind: "tokens", tokens: count });
const percent = (share: number): LimitValue => ({ kind: "percent", percent: share });
const model = (modelKey: string): SaveDestination => ({ target: "model", key: modelKey });
const saveModelLimit = (path: string, modelKey: string, count: number) =>
  saveLimit(path, model(modelKey), tokens(count));

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
    ["80%", 80],
    ["12.5%", 12.5],
    ["100%", 100],
  ])("parses %s as a context-window percentage", (text, expected) =>
    expect(parseLimit(text)).toEqual(percent(expected)),
  );
  it.each(["0", "-1", "NaN", "1e6", "300kb", "300k extra", "0.1", "9007199254740992"])(
    "rejects %s",
    (text) => expect(() => parseLimit(text)).toThrow(/Usage|Threshold/),
  );
  it.each(["0%", "150%", "100.5%"])("rejects percentage %s", (text) =>
    expect(() => parseLimit(text)).toThrow(/Percentage/),
  );
  it.each(["80 %", "%", "-5%", "k%"])("rejects malformed %j", (text) =>
    expect(() => parseLimit(text)).toThrow(/Usage/),
  );
  it("reads settings values as integers or percentage strings", () => {
    expect(limitFromSettings(300000, "x")).toEqual(tokens(300000));
    expect(limitFromSettings("80%", "x")).toEqual(percent(80));
    for (const bad of ["abc", "300k", "0%", "150%", 0, -1, 1.5, null, true]) {
      expect(() => limitFromSettings(bad, "globalLimit")).toThrow(/Invalid globalLimit/);
    }
  });
  it("resolves percentages with floor rounding", () => {
    expect(resolveLimit(percent(80), 200000)).toBe(160000);
    expect(resolveLimit(percent(33.3), 1000)).toBe(333);
    expect(resolveLimit(tokens(5), 1000)).toBe(5);
  });
  it("validates model and retained-context bounds", () => {
    expect(() => validateLimit(300000, 1000000, 20000)).not.toThrow();
    expect(() => validateLimit(20000, 1000000, 20000)).toThrow(/keepRecentTokens/);
    expect(() => validateLimit(1000000, 1000000, 20000)).toThrow(/context window/);
  });
});

describe("command arguments", () => {
  it.each([
    ["300k", tokens(300000), null],
    ["  0.3M  ", tokens(300000), null],
    ["300000", tokens(300000), null],
    ["80%", percent(80), null],
    ["300k --save", tokens(300000), "model"],
    ["--save 300k", tokens(300000), "model"],
    ["--SAVE 1m", tokens(1000000), "model"],
    ["80% --save-provider", percent(80), "provider"],
    ["--save-provider 200k", tokens(200000), "provider"],
    ["--save-global 300k", tokens(300000), "global"],
    ["90% --SAVE-GLOBAL", percent(90), "global"],
  ])("parses %j", (input, value, save) => {
    expect(parseAutocompactCommand(input)).toEqual({ kind: "limit", value, save });
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
    "off --save-provider",
    "--save-global default",
    "--save-provider",
    "--save-global",
    "300k --save-global --save-global",
  ])("rejects %j", (input) => {
    expect(() => parseAutocompactCommand(input)).toThrow(/--save|Usage|Unknown option/);
  });
  it.each(["300k --save --save-global", "--save-provider --save 300k"])(
    "rejects two save flags in %j",
    (input) => {
      expect(() => parseAutocompactCommand(input)).toThrow(/Only one of/);
    },
  );
});

describe("saved model limits", () => {
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
    expect(defaultLimits(await readSettings(path)).models).toEqual(
      new Map([
        ["a/one", tokens(1000)],
        ["b/two", tokens(2000)],
      ]),
    );
  });
});

describe("read-only configuration", () => {
  it("loads optional global model defaults", async () => {
    expect(defaultLimits(await readSettings(join(agentDir, "absent.json")))).toEqual({
      models: new Map(),
      providers: new Map(),
      global: undefined,
    });

    await writeSettings(globalSettingsPath(), {
      piAutocompact: { modelLimits: { [key]: 300000 } },
    });
    expect(defaultLimits(await readSettings(globalSettingsPath())).models.get(key)).toEqual(
      tokens(300000),
    );

    await writeSettings(globalSettingsPath(), {
      piAutocompact: {
        modelLimits: { [key]: "50%" },
        providerLimits: { provider: 200000 },
        globalLimit: "80%",
      },
    });
    expect(defaultLimits(await readSettings(globalSettingsPath()))).toEqual({
      models: new Map([[key, percent(50)]]),
      providers: new Map([["provider", tokens(200000)]]),
      global: percent(80),
    });

    for (const piAutocompact of [
      { providerLimits: [] },
      { providerLimits: { "a/b": 1000 } },
      { providerLimits: { "": 1000 } },
      { providerLimits: { provider: "abc" } },
      { globalLimit: "abc" },
      { globalLimit: 0 },
    ]) {
      await writeSettings(globalSettingsPath(), { piAutocompact });
      const settings = await readSettings(globalSettingsPath());
      expect(() => defaultLimits(settings)).toThrow(/providerLimits|globalLimit/);
    }

    await writeSettings(globalSettingsPath(), {
      piAutocompact: { modelLimits: { [key]: "300k" } },
    });
    const invalid = await readSettings(globalSettingsPath());
    expect(() => defaultLimits(invalid)).toThrow(/Invalid/);
  });

  it.each([
    ["no settings", undefined, undefined],
    ["a global value", { compaction: { reserveTokens: 10000 } }, undefined],
    [
      "a project value over a global one",
      { compaction: { reserveTokens: 10000, keepRecentTokens: 30000 } },
      { compaction: { keepRecentTokens: 25000 } },
    ],
    [
      "a global model override over a project value",
      { compaction: { modelOverrides: { [key]: { reserveTokens: 40000 } } } },
      { compaction: { reserveTokens: 5000, keepRecentTokens: 25000 } },
    ],
    [
      "a project model override over a global one",
      { compaction: { modelOverrides: { [key]: { keepRecentTokens: 40000 } } } },
      { compaction: { modelOverrides: { [key]: { keepRecentTokens: 45000 } } } },
    ],
    [
      "project disabled over global enabled",
      { compaction: { enabled: true } },
      { compaction: { enabled: false } },
    ],
    ["global disabled", { compaction: { enabled: false } }, undefined],
  ])("resolves compaction settings as Pi does with %s", async (_label, global, project) => {
    if (global) await writeSettings(globalSettingsPath(), global);
    if (project) await writeSettings(projectSettingsPath(), project);

    const expected = SettingsManager.create(projectDir, agentDir, {
      projectTrusted: true,
    }).getCompactionSettings({ provider: "provider", id: "model" });

    expect(
      effectiveCompaction(
        await readSettings(globalSettingsPath()),
        await readSettings(projectSettingsPath()),
        key,
      ),
    ).toEqual(expected);
  });
});

describe("effective limits", () => {
  const none = { session: undefined, model: undefined, provider: undefined, global: undefined };

  it("applies a cap on its own", () => {
    expect(effectiveLimit({ ...none, global: percent(80) }, 200000)).toEqual({
      tokens: 160000,
      source: "global",
    });
    expect(effectiveLimit(none, 200000)).toBeUndefined();
  });

  it("takes the lowest level", () => {
    expect(
      effectiveLimit(
        { ...none, global: tokens(300000), provider: tokens(200000), model: tokens(250000) },
        1000000,
      ),
    ).toEqual({ tokens: 200000, source: "provider" });
    expect(
      effectiveLimit({ ...none, global: tokens(300000), model: tokens(250000) }, 1000000),
    ).toEqual({ tokens: 250000, source: "model" });
  });

  it("caps a session threshold, which replaces the model limit", () => {
    expect(
      effectiveLimit(
        { ...none, session: tokens(300000), model: tokens(100000), provider: tokens(200000) },
        1000000,
      ),
    ).toEqual({ tokens: 200000, source: "provider" });
    expect(
      effectiveLimit({ ...none, session: tokens(150000), model: tokens(100000) }, 1000000),
    ).toEqual({ tokens: 150000, source: "session" });
  });

  it("clamps to the context window and reports it unusable", () => {
    const limit = effectiveLimit({ ...none, global: tokens(1000000) }, 200000);
    expect(limit).toEqual({ tokens: 200000, source: "window" });
    expect(unusableReason(200000, 200000, 20000)).toMatch(/context window/);
    expect(effectiveLimit({ ...none, global: percent(100) }, 200000)).toEqual({
      tokens: 200000,
      source: "global",
    });
  });
});

describe("saved caps", () => {
  it("writes provider and global caps next to model limits", async () => {
    const path = globalSettingsPath();
    await writeSettings(path, {
      theme: "dark",
      piAutocompact: { modelLimits: { [key]: 300000 }, providerLimits: { other: 1000 } },
    });
    await saveLimit(path, { target: "provider", provider: "provider" }, percent(80));
    await saveLimit(path, { target: "global" }, tokens(300000));
    await saveLimit(path, model("provider/second"), percent(12.5));
    expect(await readSettings(path)).toEqual({
      theme: "dark",
      piAutocompact: {
        modelLimits: { [key]: 300000, "provider/second": "12.5%" },
        providerLimits: { other: 1000, provider: "80%" },
        globalLimit: 300000,
      },
    });
    await expect(stat(`${resolve(path)}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
