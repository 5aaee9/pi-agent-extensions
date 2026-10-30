import { writeFile } from "node:fs/promises";

import { Context } from "@deepseek-ai/cordis";
import { CommandRuntime } from "@deepseek-ai/dsh-commands";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { apply, Config, inject, name, type ReasoningEffortsConfig } from "../index.ts";

import { createHost, modelField } from "./fixture.ts";

const declarations = {
  magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high", max: "max" } },
};

const vision = {
  magpie: { "ollama-cloud/kimi-k3": ["text", "image"] },
};

async function loadError(config: ReasoningEffortsConfig): Promise<Error> {
  const ctx = new Context();
  onTestFinished(async () => {
    await ctx.fiber.dispose();
  });
  await ctx.plugin(CommandRuntime).await();
  try {
    await ctx.plugin({ apply, inject: [...inject] }, config).await();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("the plugin loaded with a malformed declaration");
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}

describe("plugin identity", () => {
  it("names the plugin and requires the command registry", () => {
    expect(name).toBe("custom-provider-reasoning-efforts");
    expect(inject).toEqual(["commands"]);
  });

  it("keeps the row's defaults", () => {
    const parsed = Config({});
    expect(parsed.providers).toEqual({});
    expect(parsed.vision).toEqual({});
    expect(parsed.discover).toBe(true);
    expect(parsed.discoverRoutes).toEqual([]);
    expect(parsed.namespace).toBe("llm-pi-ai");
    expect(parsed.applyOnLoad).toBe(true);
  });
});

describe("the plugin loaded as a real profile row", () => {
  it("registers the /reasoning-efforts command", async () => {
    const host = await createHost();
    expect(host.definition.name).toBe("reasoning-efforts");
    expect(host.definition.definitionId).toBe("@indexyz/dsh-custom-provider-reasoning-efforts");
    expect(host.definition.input?.hint).toBe("status | apply | discover | clear");
  });

  it("fails the load on a malformed declaration", async () => {
    const error = await loadError({ providers: { magpie: { "ollama-cloud/x": {} } } });
    expect(error.message).toMatch(/is empty/);
  });

  it("fails the load on a malformed vision declaration", async () => {
    const empty = await loadError({ vision: { magpie: { "ollama-cloud/x": [] } } });
    expect(empty.message).toMatch(/names no modality/);
    const unknown = await loadError({
      vision: { magpie: { "ollama-cloud/x": ["text", "video"] } },
    });
    expect(unknown.message).toMatch(
      /route "magpie" model "ollama-cloud\/x".*"video" is not a pi-ai model modality/,
    );
  });

  it("applies a vision declaration through the settings service", async () => {
    const host = await createHost({ config: { vision, applyOnLoad: false } });
    const result = await host.run("apply");

    expect(result.text).toMatch(/applied 1 change\(s\)/);
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "input")).toEqual([
      "text",
      "image",
    ]);
  });

  it("clears the vision table's input field", async () => {
    const host = await createHost({ config: { vision, applyOnLoad: false } });
    await host.run("apply");
    const cleared = await host.run("clear");

    expect(cleared.text).toMatch(/applied 1 change\(s\)/);
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "input")).toBeUndefined();
  });

  it("answers status without writing", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
        applyOnLoad: false,
      },
    });
    const persisted = await host.readPatch();
    const result = await host.run("status");

    expect(result.kind).toBe("success");
    expect(result.text).toMatch(/1 pending change\(s\)/);
    expect(await host.readPatch()).toBe(persisted);
  });

  it("applies the declarations through the settings service", async () => {
    const host = await createHost({ config: { providers: declarations, applyOnLoad: false } });
    const result = await host.run("apply");

    expect(result.text).toMatch(/applied 1 change\(s\)/);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low", high: "high", max: "max" });
  });

  it("clears the declared fields", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        applyOnLoad: false,
      },
    });
    await host.run("apply");
    const cleared = await host.run("clear");

    expect(cleared.text).toMatch(/applied 1 change\(s\)/);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toBeUndefined();
  });

  it("clears both tables' fields in one pass", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        vision,
        applyOnLoad: false,
      },
    });
    await host.run("apply");
    const cleared = await host.run("clear");

    expect(cleared.text).toMatch(/applied 2 change\(s\)/);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toBeUndefined();
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "input")).toBeUndefined();
  });

  it("answers an unknown argument with the usage line", async () => {
    const host = await createHost();
    const result = await host.run("soon");

    expect(result).toEqual({
      kind: "error",
      text: "Usage: /reasoning-efforts [status | apply | discover | clear]",
    });
  });

  it("reports a real write failure without throwing out of the command", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        applyOnLoad: false,
      },
    });
    await writeFile(host.patchPath, "{}\n");
    const result = await host.run("apply");

    expect(result.kind).toBe("error");
    expect(result.text).toMatch(
      /^reasoning-efforts: dsh: overlay .* must be a top-level YAML array/,
    );
  });

  it("honours a namespace override", async () => {
    const host = await createHost({
      namespace: "custom-providers",
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        namespace: "custom-providers",
        applyOnLoad: false,
      },
    });
    const result = await host.run("apply");

    expect(result.text).toMatch(/applied 1 change\(s\) to "custom-providers"/);
    expect(host.descriptor()?.ns).toBe("custom-providers");
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toEqual({ low: "low" });
  });
});

describe("the load-time pass on the real service graph", () => {
  it("waits for the launcher's readiness signal", async () => {
    const host = await createHost({
      appReady: true,
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
        discover: false,
      },
    });
    await vi.waitFor(() => {
      expect(host.readyPending()).toBe(1);
    });
    expect(modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts")).toBe(
      undefined,
    );

    host.triggerReady();
    await vi.waitFor(() => {
      expect(
        modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
      ).toEqual({ low: "low", high: "high" });
    });
    expect(host.logs.some((line) => line.startsWith("info reasoning-efforts: applied"))).toBe(true);
  });

  it("runs immediately when no readiness signal is provided", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
        discover: false,
      },
    });
    await vi.waitFor(() => {
      expect(
        modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
      ).toEqual({ low: "low", high: "high" });
    });
  });

  it("does nothing when applyOnLoad is off", async () => {
    const host = await createHost({
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        discover: false,
        applyOnLoad: false,
      },
    });
    await flush();
    expect(host.readyPending()).toBe(0);
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toBeUndefined();
    expect(await host.readPatch()).not.toContain("reasoningEfforts");
  });

  it("contains a failed pass to the log", async () => {
    const host = await createHost({
      rejectWrites: true,
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        discover: false,
      },
    });
    await vi.waitFor(() => {
      expect(
        host.logs.some((line) =>
          line.startsWith("warn reasoning-efforts: the load-time pass failed"),
        ),
      ).toBe(true);
    });
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toBeUndefined();
  });

  it("reports the missing service through the command when none is mounted", async () => {
    const host = await createHost({
      settings: false,
      config: {
        providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
        discover: false,
      },
    });
    await flush();
    const result = await host.run("apply");

    expect(result.kind).toBe("success");
    expect(result.text).toMatch(/no configurable "llm-pi-ai" entry is mounted/);
    expect(host.logs.some((line) => line.includes("load-time pass"))).toBe(false);
  });
});
