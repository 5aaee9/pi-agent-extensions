import { describe, expect, it } from "vitest";

import { planProviders } from "../plan.ts";

import { magpieProfile } from "./fixture.ts";

describe("planProviders", () => {
  it("adds the declared field without touching the rest of the entry", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "magpie", model: "ollama-cloud/kimi-k3", value: { low: "low", high: "high" } },
    ]);
    expect(plan.changes).toEqual([
      {
        field: "reasoningEfforts",
        route: "magpie",
        model: "ollama-cloud/kimi-k3",
        before: undefined,
        after: { low: "low", high: "high" },
      },
    ]);
    const providers = plan.providers as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]).toEqual({
      id: "ollama-cloud/kimi-k3",
      name: "Kimi K3",
      contextWindow: 1048576,
      maxTokens: 131072,
      input: ["text"],
      reasoningEfforts: { low: "low", high: "high" },
    });
    expect(providers.magpie.models[1]).not.toHaveProperty("reasoningEfforts");
    expect(plan.skipped).toEqual([]);
  });

  it("reports nothing to remove for an entry with no field", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "magpie", model: "ollama-cloud/kimi-k3", value: undefined },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a catalog route without an explicit models list", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "opencode-go", model: "some-model", value: { high: "high" } },
    ]);
    expect(plan.skipped[0]?.reason).toMatch(/declares no explicit models list/);
  });

  it("skips every intent when the profile carries no providers table", () => {
    const plan = planProviders({}, [{ route: "magpie", model: "x", value: { low: "low" } }]);
    expect(plan.providers).toBeUndefined();
    expect(plan.skipped[0]?.reason).toMatch(/no providers table/);
  });

  it("does not mutate its input", () => {
    const user = magpieProfile();
    planProviders(user, [
      { route: "magpie", model: "ollama-cloud/kimi-k3", value: { low: "low" } },
    ]);
    const providers = user["providers"] as { magpie: { models: Array<Record<string, unknown>> } };
    expect(providers.magpie.models[0]).not.toHaveProperty("reasoningEfforts");
  });

  it("lands both fields of one entry through the same planned value", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "magpie", model: "ollama-cloud/deepseek-v4.1-flash", value: { low: "low" } },
      {
        field: "input",
        route: "magpie",
        model: "ollama-cloud/deepseek-v4.1-flash",
        value: ["text", "image"],
      },
    ]);
    expect(plan.changes.map((change) => change.field)).toEqual(["reasoningEfforts", "input"]);
    const providers = plan.providers as { magpie: { models: Array<Record<string, unknown>> } };
    expect(providers.magpie.models[1]).toEqual({
      id: "ollama-cloud/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: 1048576,
      maxTokens: 384000,
      input: ["text", "image"],
      reasoningEfforts: { low: "low" },
    });
  });

  it("keeps reasoningEfforts when a vision declaration rewrites input", () => {
    const user = magpieProfile();
    const providers = user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    providers.magpie.models[0] = {
      ...providers.magpie.models[0],
      reasoningEfforts: { low: "low" },
    };
    const plan = planProviders(user, [
      {
        field: "input",
        route: "magpie",
        model: "ollama-cloud/kimi-k3",
        value: ["text", "image"],
      },
    ]);
    expect(plan.changes.map((change) => change.field)).toEqual(["input"]);
    const next = plan.providers as { magpie: { models: Array<Record<string, unknown>> } };
    expect(next.magpie.models[0]["reasoningEfforts"]).toEqual({ low: "low" });
    expect(next.magpie.models[0]["input"]).toEqual(["text", "image"]);
  });

  it("removes only the tagged field a clear intent names", () => {
    const user = magpieProfile();
    const providers = user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    providers.magpie.models[0] = {
      ...providers.magpie.models[0],
      input: ["text", "image"],
      reasoningEfforts: { low: "low" },
    };
    const plan = planProviders(user, [
      {
        field: "input",
        route: "magpie",
        model: "ollama-cloud/kimi-k3",
        value: undefined,
      },
    ]);
    expect(plan.changes.map((change) => change.field)).toEqual(["input"]);
    const next = plan.providers as { magpie: { models: Array<Record<string, unknown>> } };
    expect(next.magpie.models[0]).not.toHaveProperty("input");
    expect(next.magpie.models[0]["reasoningEfforts"]).toEqual({ low: "low" });
  });

  it("carries the field on a skip", () => {
    const plan = planProviders(magpieProfile(), [
      {
        field: "input",
        route: "magpie",
        model: "ollama-cloud/glm-5.3",
        value: ["text", "image"],
      },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        field: "input",
        route: "magpie",
        model: "ollama-cloud/glm-5.3",
        reason: 'route "magpie" does not declare model "ollama-cloud/glm-5.3"',
      },
    ]);
  });

  it("carries the field on a skip when the profile carries no providers table", () => {
    const plan = planProviders({}, [
      { field: "input", route: "magpie", model: "x", value: ["text"] },
    ]);
    expect(plan.providers).toBeUndefined();
    expect(plan.skipped[0]).toMatchObject({ field: "input", reason: /no providers table/ });
  });
});
