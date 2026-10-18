import { describe, expect, it, vi } from "vitest";
import type { CommandInvocation } from "@deepseek-ai/dsh-commands";

import { DeclarationError } from "../declarations.ts";
import { apply, Config, inject, name } from "../index.ts";

import { createHarness, fakeSettings, flush, magpieProfile } from "./fixture.ts";

function invocation(rawInput: string): CommandInvocation {
  return {
    rawInput,
    signal: new AbortController().signal,
  } as unknown as CommandInvocation;
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

describe("apply", () => {
  it("registers the /reasoning-efforts command", () => {
    const harness = createHarness({ settings: fakeSettings(magpieProfile()).seam });
    apply(harness.ctx, { applyOnLoad: false });
    expect(harness.definitions).toHaveLength(1);
    const definition = harness.definitions[0];
    expect(definition?.name).toBe("reasoning-efforts");
    expect(definition?.definitionId).toBe("@indexyz/dsh-custom-provider-reasoning-efforts");
    expect(definition?.input?.hint).toBe("status | apply | discover | clear");
  });

  it("fails the load on a malformed declaration", () => {
    const harness = createHarness();
    expect(() => apply(harness.ctx, { providers: { magpie: { x: {} } } })).toThrow(
      DeclarationError,
    );
    expect(harness.definitions).toEqual([]);
  });

  it("fails the load on a malformed vision declaration", () => {
    const harness = createHarness();
    expect(() => apply(harness.ctx, { vision: { magpie: { x: [] } } })).toThrow(DeclarationError);
    expect(() => apply(harness.ctx, { vision: { magpie: { x: ["text", "video"] } } })).toThrow(
      /route "magpie" model "x".*"video" is not a pi-ai model modality/,
    );
    expect(harness.definitions).toEqual([]);
  });

  it("applies a vision declaration through the settings service", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      vision: { magpie: { "ollama-cloud/kimi-k3": ["text", "image"] } },
      applyOnLoad: false,
    });
    const result = await harness.definitions[0]?.handler(invocation("apply"));
    expect(result?.text).toMatch(/applied 1 change\(s\)/);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["input"]).toEqual(["text", "image"]);
  });

  it("clears the vision table's input field", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      vision: { magpie: { "ollama-cloud/kimi-k3": ["text", "image"] } },
      applyOnLoad: false,
    });
    await harness.definitions[0]?.handler(invocation("apply"));
    const cleared = await harness.definitions[0]?.handler(invocation("clear"));
    expect(cleared?.text).toMatch(/applied 1 change\(s\)/);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]).not.toHaveProperty("input");
  });

  it("answers status without writing", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
      applyOnLoad: false,
    });
    const result = await harness.definitions[0]?.handler(invocation("status"));
    expect(result?.kind).toBe("success");
    expect(result?.text).toMatch(/1 pending change\(s\)/);
    expect(fake.calls).toEqual([]);
  });

  it("applies the declarations through the settings service", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high", max: "max" } } },
      applyOnLoad: false,
    });
    const result = await harness.definitions[0]?.handler(invocation("apply"));
    expect(result?.text).toMatch(/applied 1 change\(s\)/);
    expect(fake.calls).toHaveLength(1);
  });

  it("clears the declared fields", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      applyOnLoad: false,
    });
    await harness.definitions[0]?.handler(invocation("apply"));
    const cleared = await harness.definitions[0]?.handler(invocation("clear"));
    expect(cleared?.text).toMatch(/applied 1 change\(s\)/);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]).not.toHaveProperty("reasoningEfforts");
  });

  it("clears both tables' fields in one pass", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      vision: { magpie: { "ollama-cloud/kimi-k3": ["text", "image"] } },
      applyOnLoad: false,
    });
    await harness.definitions[0]?.handler(invocation("apply"));
    const cleared = await harness.definitions[0]?.handler(invocation("clear"));
    expect(cleared?.text).toMatch(/applied 2 change\(s\)/);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]).not.toHaveProperty("reasoningEfforts");
    expect(providers.magpie.models[0]).not.toHaveProperty("input");
  });

  it("answers an unknown argument with the usage line", async () => {
    const harness = createHarness({ settings: fakeSettings(magpieProfile()).seam });
    apply(harness.ctx, { applyOnLoad: false });
    const result = await harness.definitions[0]?.handler(invocation("soon"));
    expect(result).toEqual({
      kind: "error",
      text: "Usage: /reasoning-efforts [status | apply | discover | clear]",
    });
  });

  it("reports a write failure without throwing out of the command", async () => {
    const harness = createHarness({
      settings: {
        writable: true,
        describe: () => [
          { ns: "llm-pi-ai", revision: 1, value: magpieProfile(), user: magpieProfile() },
        ],
        update: () => Promise.reject(new Error("llm-pi-ai rejected the declaration")),
      },
    });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      applyOnLoad: false,
    });
    const result = await harness.definitions[0]?.handler(invocation("apply"));
    expect(result).toEqual({
      kind: "error",
      text: "reasoning-efforts: llm-pi-ai rejected the declaration",
    });
  });

  it("honours a namespace override", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      namespace: "llm-pi-ai",
      applyOnLoad: false,
    });
    await harness.definitions[0]?.handler(invocation("apply"));
    expect(fake.calls[0]?.ns).toBe("llm-pi-ai");
  });
});

describe("load-time pass", () => {
  it("waits for the launcher's readiness signal", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam, appReady: true });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
      discover: false,
    });
    harness.injectAll();
    expect(fake.calls).toEqual([]);
    harness.triggerReady();
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(harness.logs.some((line) => line.startsWith("info reasoning-efforts: applied"))).toBe(
      true,
    );
  });

  it("runs immediately when no readiness signal is provided", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low", high: "high" } } },
      discover: false,
    });
    harness.injectAll();
    await flush();
    expect(fake.calls).toHaveLength(1);
  });

  it("does nothing when applyOnLoad is off", async () => {
    const fake = fakeSettings(magpieProfile());
    const harness = createHarness({ settings: fake.seam });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      applyOnLoad: false,
    });
    harness.injectAll();
    harness.triggerReady();
    await flush();
    expect(fake.calls).toEqual([]);
  });

  it("contains a failed pass to the log", async () => {
    const harness = createHarness({
      settings: {
        writable: true,
        describe: () => [
          { ns: "llm-pi-ai", revision: 1, value: magpieProfile(), user: magpieProfile() },
        ],
        update: () => Promise.reject(new Error("the Loader refused the write")),
      },
    });
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      discover: false,
    });
    harness.injectAll();
    await vi.waitFor(
      () => {
        expect(
          harness.logs.some((line) =>
            line.startsWith("warn reasoning-efforts: the load-time pass failed"),
          ),
        ).toBe(true);
      },
      { timeout: 5000, interval: 25 },
    );
  });

  it("writes nothing and reports the missing service when none is mounted", async () => {
    const harness = createHarness();
    apply(harness.ctx, {
      providers: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      discover: false,
    });
    harness.injectAll();
    await vi.waitFor(
      () => {
        expect(harness.logs).toEqual([
          'debug reasoning-efforts: no configurable "llm-pi-ai" entry is mounted, so there is nothing to declare',
        ]);
      },
      { timeout: 5000, interval: 25 },
    );
  });
});
