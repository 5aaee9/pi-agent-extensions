import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestModeStore, writeRequestModes } from "../request-mode-store.ts";

const failures = vi.hoisted(() => ({ rename: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (failures.rename) throw new Error("rename failed");
      return actual.rename(...args);
    },
  };
});

let dir: string;
let configPath: string;

const marker = () => join(dir, "executed");
const config = () => ({
  relay: {
    baseURL: "https://relay.example",
    token: `!touch ${marker()}`,
    api: "openai-responses",
    futureSetting: { keep: [1, 2] },
    requestModes: { serviceTier: "fast" },
    modelRequestModes: { "gpt-synthetic-b": { daybreak: "blue" } },
  },
  other: { baseURL: "https://other.example", token: "${SUB2API_TOKEN}" },
});
const read = () => JSON.parse(readFileSync(configPath, "utf8")) as Record<string, any>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sub2api-save-"));
  configPath = join(dir, "sub2api.json");
  writeFileSync(configPath, JSON.stringify(config()), { mode: 0o600 });
  chmodSync(configPath, 0o600);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("request mode store", () => {
  it("replaces only the model entry and preserves everything else", async () => {
    await writeRequestModes(
      configPath,
      { provider: "relay", modelId: "gpt-synthetic-a" },
      { serviceTier: "default", daybreak: "standard" },
    );
    const expected = config();
    expect(read()).toEqual({
      ...expected,
      relay: {
        ...expected.relay,
        modelRequestModes: {
          "gpt-synthetic-b": { daybreak: "blue" },
          "gpt-synthetic-a": { serviceTier: "default", daybreak: "standard" },
        },
      },
    });
    expect(readFileSync(configPath, "utf8")).toBe(`${JSON.stringify(read(), null, 2)}\n`);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["sub2api.json"]);
    expect(existsSync(marker())).toBe(false);
  });

  it("replaces the provider defaults without touching model overrides", async () => {
    await writeRequestModes(configPath, { provider: "relay" }, {});
    const saved = read();
    expect(saved.relay.requestModes).toEqual({});
    expect(saved.relay.modelRequestModes).toEqual({ "gpt-synthetic-b": { daybreak: "blue" } });
    expect(saved.relay.token).toBe(`!touch ${marker()}`);
    expect(saved.other).toEqual(config().other);
  });

  it("creates modelRequestModes and keeps a dangerous-looking model key as data", async () => {
    await writeRequestModes(
      configPath,
      { provider: "other", modelId: "__proto__" },
      {
        serviceTier: "fast",
      },
    );
    const saved = read();
    expect(Object.hasOwn(saved.other.modelRequestModes, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(saved.other.modelRequestModes, "__proto__")?.value,
    ).toEqual({ serviceTier: "fast" });
  });

  it("merges into the latest file contents instead of a startup snapshot", async () => {
    const edited = { ...config(), added: { baseURL: "https://added.example", token: "t" } };
    edited.other.baseURL = "https://edited.example";
    writeFileSync(configPath, JSON.stringify(edited));
    await writeRequestModes(configPath, { provider: "relay" }, { daybreak: "blue" });
    const saved = read();
    expect(saved.added).toEqual(edited.added);
    expect(saved.other.baseURL).toBe("https://edited.example");
    expect(saved.relay.requestModes).toEqual({ daybreak: "blue" });
  });

  it("keeps the permissions of a more permissive file and writes through symlinks", async () => {
    chmodSync(configPath, 0o640);
    const linked = join(dir, "link.json");
    symlinkSync(configPath, linked);
    await writeRequestModes(linked, { provider: "relay" }, { serviceTier: "ultrafast" });
    expect(statSync(configPath).mode & 0o777).toBe(0o640);
    expect(read().relay.requestModes).toEqual({ serviceTier: "ultrafast" });
    expect(readdirSync(dir).sort()).toEqual(["link.json", "sub2api.json"]);
  });

  it.each([
    ["missing configuration", () => rmSync(configPath), /ENOENT/],
    [
      "malformed JSON without echoing content",
      () => writeFileSync(configPath, '{"relay": {"token": "sk-secret-value"'),
      /^configuration is not valid JSON$/,
    ],
    ["non-object configuration", () => writeFileSync(configPath, "[]"), /top-level value/],
    [
      "missing provider",
      () => writeFileSync(configPath, JSON.stringify({ other: config().other })),
      /provider relay is not an object/,
    ],
    [
      "non-object provider",
      () => writeFileSync(configPath, JSON.stringify({ relay: "x" })),
      /provider relay is not an object/,
    ],
    [
      "malformed model overrides",
      () =>
        writeFileSync(
          configPath,
          JSON.stringify({ relay: { ...config().relay, modelRequestModes: [] } }),
        ),
      /modelRequestModes must be an object/,
    ],
  ])("fails without writing on %s", async (_name, arrange, message) => {
    arrange();
    const before = (() => {
      try {
        return readFileSync(configPath, "utf8");
      } catch {
        return undefined;
      }
    })();
    const error = await writeRequestModes(
      configPath,
      { provider: "relay", modelId: "gpt-synthetic-a" },
      { serviceTier: "fast" },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain("sk-secret-value");
    const after = (() => {
      try {
        return readFileSync(configPath, "utf8");
      } catch {
        return undefined;
      }
    })();
    expect(after).toBe(before);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves the destination unchanged when the directory is not writable", async () => {
    chmodSync(dir, 0o500);
    try {
      await expect(writeRequestModes(configPath, { provider: "relay" }, {})).rejects.toThrow(
        /EACCES/,
      );
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(read()).toEqual(config());
    expect(readdirSync(dir)).toEqual(["sub2api.json"]);
  });

  it("removes the temporary file when the replace fails", async () => {
    failures.rename = true;
    try {
      await expect(writeRequestModes(configPath, { provider: "relay" }, {})).rejects.toThrow(
        "rename failed",
      );
    } finally {
      failures.rename = false;
    }
    expect(read()).toEqual(config());
    expect(readdirSync(dir)).toEqual(["sub2api.json"]);
  });

  it("serializes queued saves and keeps the queue alive after a failure", async () => {
    const save = createRequestModeStore(configPath);
    const results = await Promise.allSettled([
      save({ provider: "relay", modelId: "gpt-synthetic-a" }, { serviceTier: "fast" }),
      save({ provider: "missing" }, {}),
      save({ provider: "relay", modelId: "gpt-synthetic-c" }, { daybreak: "standard" }),
      save({ provider: "relay" }, { serviceTier: "default" }),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    const saved = read();
    expect(saved.relay.modelRequestModes).toEqual({
      "gpt-synthetic-b": { daybreak: "blue" },
      "gpt-synthetic-a": { serviceTier: "fast" },
      "gpt-synthetic-c": { daybreak: "standard" },
    });
    expect(saved.relay.requestModes).toEqual({ serviceTier: "default" });
    expect(existsSync(marker())).toBe(false);
  });
});
