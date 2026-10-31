import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { applyIntents, type SettingsSeam } from "../apply.ts";
import type { Intent } from "../plan.ts";

import { conflictingSeam, createHost, modelField, settingsSeam } from "./fixture.ts";

const intents: readonly Intent[] = [
  {
    route: "magpie",
    model: "ollama-cloud/kimi-k3",
    value: { low: "low", high: "high", max: "max" },
  },
];

const visionIntent: Intent = {
  field: "input",
  route: "magpie",
  model: "ollama-cloud/kimi-k3",
  value: ["text", "image"],
};

describe("applyIntents through the real settings service", () => {
  it("writes the planned providers value and persists it to the profile patch", async () => {
    const host = await createHost();
    const before = host.descriptor()?.revision;
    const result = await applyIntents(settingsSeam(host.ctx), {
      namespace: "llm-pi-ai",
      intents,
    });

    expect(result.kind).toBe("applied");
    expect(result.changes).toHaveLength(1);
    expect(host.descriptor()?.revision).toBe((before ?? 0) + 1);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low", high: "high", max: "max" });
    expect(await host.readPatch()).toContain("reasoningEfforts");
  });

  it("does not write when every declaration is already current", async () => {
    const host = await createHost();
    await applyIntents(settingsSeam(host.ctx), { namespace: "llm-pi-ai", intents });
    const persisted = await host.readPatch();
    const second = await applyIntents(settingsSeam(host.ctx), {
      namespace: "llm-pi-ai",
      intents,
    });

    expect(second.kind).toBe("unchanged");
    expect(await host.readPatch()).toBe(persisted);
  });

  it("plans without writing on a dry run", async () => {
    const host = await createHost();
    const persisted = await host.readPatch();
    const result = await applyIntents(settingsSeam(host.ctx), {
      namespace: "llm-pi-ai",
      intents,
      dryRun: true,
    });

    expect(result.kind).toBe("pending");
    expect(result.changes).toHaveLength(1);
    expect(await host.readPatch()).toBe(persisted);
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts")).toBe(
      undefined,
    );
  });

  it("reports an absent namespace", async () => {
    const host = await createHost();
    const result = await applyIntents(settingsSeam(host.ctx), {
      namespace: "missing",
      intents,
    });

    expect(result.kind).toBe("unavailable");
    expect(await host.readPatch()).not.toContain("reasoningEfforts");
  });

  it("reports a profile that does not accept edits", async () => {
    const host = await createHost();
    // Boundary (see `settingsSeam` in fixture.ts): the pinned SettingsForms
    // reports `writable` as `true` unconditionally, so no real profile reaches
    // this branch. Only `writable` is overridden; the descriptor the writer
    // reads is the real service's, and the assertion re-reads the real file.
    const readonly: SettingsSeam = { ...settingsSeam(host.ctx), writable: false };
    const result = await applyIntents(readonly, { namespace: "llm-pi-ai", intents });

    expect(result.kind).toBe("readonly");
    expect(await host.readPatch()).not.toContain("reasoningEfforts");
  });

  it("retries once against a fresh descriptor after a real revision conflict", async () => {
    const host = await createHost();
    const competitor = {
      magpie: { models: [{ id: "ollama-cloud/kimi-k3", name: "competing" }] },
    };
    const result = await applyIntents(conflictingSeam(host.ctx, competitor), {
      namespace: "llm-pi-ai",
      intents,
    });

    expect(result.kind).toBe("applied");
    expect(host.descriptor()?.revision).toBe(2);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low", high: "high", max: "max" });
    // The retry planned against the competing save, so its entry is what gained the fields.
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "name")).toBe(
      "competing",
    );
  });

  it("propagates a write failure that is not a conflict", async () => {
    const host = await createHost();
    // A profile patch that is not a patch list makes the real editor's save fail.
    await writeFile(host.patchPath, "{}\n");
    await expect(
      applyIntents(settingsSeam(host.ctx), { namespace: "llm-pi-ai", intents }),
    ).rejects.toThrow(/top-level YAML array/);
    expect(await host.readPatch()).toBe("{}\n");
  });

  it("reports the skips alongside the applied changes", async () => {
    const host = await createHost();
    const result = await applyIntents(settingsSeam(host.ctx), {
      namespace: "llm-pi-ai",
      intents: [...intents, { route: "magpie", model: "missing", value: { low: "low" } }],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("issues one write whose plan changed both fields of the same entry", async () => {
    const host = await createHost();
    const result = await applyIntents(settingsSeam(host.ctx), {
      namespace: "llm-pi-ai",
      intents: [...intents, visionIntent],
    });

    expect(result.kind).toBe("applied");
    expect(result.changes.map((change) => change.field)).toEqual(["reasoningEfforts", "input"]);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low", high: "high", max: "max" });
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "input")).toEqual([
      "text",
      "image",
    ]);
  });

  it("retries a conflicting write that carries both fields", async () => {
    const host = await createHost();
    const competitor = {
      magpie: { models: [{ id: "ollama-cloud/kimi-k3", name: "competing" }] },
    };
    const result = await applyIntents(conflictingSeam(host.ctx, competitor), {
      namespace: "llm-pi-ai",
      intents: [...intents, visionIntent],
    });

    expect(result.kind).toBe("applied");
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "input")).toEqual([
      "text",
      "image",
    ]);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low", high: "high", max: "max" });
  });
});
