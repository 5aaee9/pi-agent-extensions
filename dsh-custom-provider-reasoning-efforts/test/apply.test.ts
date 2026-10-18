import { describe, expect, it } from "vitest";

import { applyIntents, type SettingsSeam } from "../apply.ts";

import { fakeSettings, magpieProfile } from "./fixture.ts";

const intents = [
  {
    route: "magpie",
    model: "ollama-cloud/kimi-k3",
    value: { low: "low", high: "high", max: "max" },
  },
] as const;

describe("applyIntents", () => {
  it("writes the planned providers value with the descriptor's revision", async () => {
    const fake = fakeSettings(magpieProfile());
    const result = await applyIntents(fake.seam, { namespace: "llm-pi-ai", intents });
    expect(result.kind).toBe("applied");
    expect(result.changes).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.ns).toBe("llm-pi-ai");
    expect(fake.calls[0]?.revision).toBe(3);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
  });

  it("does not write when every declaration is already current", async () => {
    const fake = fakeSettings(magpieProfile());
    await applyIntents(fake.seam, { namespace: "llm-pi-ai", intents });
    const second = await applyIntents(fake.seam, { namespace: "llm-pi-ai", intents });
    expect(second.kind).toBe("unchanged");
    expect(fake.calls).toHaveLength(1);
  });

  it("plans without writing on a dry run", async () => {
    const fake = fakeSettings(magpieProfile());
    const result = await applyIntents(fake.seam, {
      namespace: "llm-pi-ai",
      intents,
      dryRun: true,
    });
    expect(result.kind).toBe("pending");
    expect(result.changes).toHaveLength(1);
    expect(fake.calls).toEqual([]);
  });

  it("reports an absent namespace", async () => {
    const empty: SettingsSeam = {
      writable: true,
      describe: () => [],
      update: async () => {},
    };
    const result = await applyIntents(empty, { namespace: "llm-pi-ai", intents });
    expect(result.kind).toBe("unavailable");
  });

  it("reports a profile that does not accept edits", async () => {
    const fake = fakeSettings(magpieProfile());
    const seam: SettingsSeam = { ...fake.seam, writable: false };
    const result = await applyIntents(seam, { namespace: "llm-pi-ai", intents });
    expect(result.kind).toBe("readonly");
    expect(fake.calls).toEqual([]);
  });

  it("retries once against a fresh descriptor after a revision conflict", async () => {
    const fake = fakeSettings(magpieProfile());
    fake.state.conflicts = 1;
    const result = await applyIntents(fake.seam, { namespace: "llm-pi-ai", intents });
    expect(result.kind).toBe("applied");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.revision).toBe(4);
  });

  it("propagates a write failure that is not a conflict", async () => {
    const seam: SettingsSeam = {
      writable: true,
      describe: () => [
        { ns: "llm-pi-ai", revision: 1, value: magpieProfile(), user: magpieProfile() },
      ],
      update: () => Promise.reject(new Error("invalid reasoningEfforts")),
    };
    await expect(applyIntents(seam, { namespace: "llm-pi-ai", intents })).rejects.toThrow(
      /invalid reasoningEfforts/,
    );
  });

  it("reports the skips alongside the applied changes", async () => {
    const fake = fakeSettings(magpieProfile());
    const result = await applyIntents(fake.seam, {
      namespace: "llm-pi-ai",
      intents: [...intents, { route: "magpie", model: "missing", value: { low: "low" } }],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("issues one write whose plan changed both fields of the same entry", async () => {
    const fake = fakeSettings(magpieProfile());
    const result = await applyIntents(fake.seam, {
      namespace: "llm-pi-ai",
      intents: [
        ...intents,
        {
          field: "input",
          route: "magpie",
          model: "ollama-cloud/kimi-k3",
          value: ["text", "image"],
        },
      ],
    });
    expect(result.kind).toBe("applied");
    expect(result.changes.map((change) => change.field)).toEqual(["reasoningEfforts", "input"]);
    expect(fake.calls).toHaveLength(1);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
    expect(providers.magpie.models[0]?.["input"]).toEqual(["text", "image"]);
  });

  it("retries a conflicting write that carries both fields", async () => {
    const fake = fakeSettings(magpieProfile());
    fake.state.conflicts = 1;
    const result = await applyIntents(fake.seam, {
      namespace: "llm-pi-ai",
      intents: [
        ...intents,
        {
          field: "input",
          route: "magpie",
          model: "ollama-cloud/kimi-k3",
          value: ["text", "image"],
        },
      ],
    });
    expect(result.kind).toBe("applied");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.revision).toBe(4);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["input"]).toEqual(["text", "image"]);
    expect(providers.magpie.models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
  });
});
