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

  it("reports nothing to change when the field already carries the declaration", () => {
    const user = magpieProfile();
    const providers = user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    providers.magpie.models[0] = {
      ...providers.magpie.models[0],
      reasoningEfforts: { low: "low" },
    };
    const plan = planProviders(user, [
      { route: "magpie", model: "ollama-cloud/kimi-k3", value: { low: "low" } },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("removes the field when the intent has no value", () => {
    const user = magpieProfile();
    const providers = user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    providers.magpie.models[1] = {
      ...providers.magpie.models[1],
      reasoningEfforts: { high: "high" },
    };
    const plan = planProviders(user, [
      { route: "magpie", model: "ollama-cloud/deepseek-v4.1-flash", value: undefined },
    ]);
    expect(plan.changes).toEqual([
      {
        route: "magpie",
        model: "ollama-cloud/deepseek-v4.1-flash",
        before: { high: "high" },
        after: undefined,
      },
    ]);
    const next = plan.providers as { magpie: { models: Array<Record<string, unknown>> } };
    expect(next.magpie.models[1]).not.toHaveProperty("reasoningEfforts");
  });

  it("reports nothing to remove for an entry with no field", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "magpie", model: "ollama-cloud/kimi-k3", value: undefined },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a route the profile does not declare", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "zero-aicoding-codex", model: "gpt-6-sol", value: { high: "high" } },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/does not declare route "zero-aicoding-codex"/);
  });

  it("skips a catalog route without an explicit models list", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "opencode-go", model: "some-model", value: { high: "high" } },
    ]);
    expect(plan.skipped[0]?.reason).toMatch(/declares no explicit models list/);
  });

  it("skips a model the route does not declare", () => {
    const plan = planProviders(magpieProfile(), [
      { route: "magpie", model: "ollama-cloud/glm-5.3", value: { high: "high" } },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/does not declare model "ollama-cloud\/glm-5.3"/);
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
});
