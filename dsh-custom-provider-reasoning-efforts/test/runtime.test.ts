import { describe, expect, it, vi } from "vitest";

import type { SettingsSeam } from "../apply.ts";
import {
  createRuntime,
  describeResult,
  runUntilAvailable,
  type CredentialSeam,
  type LoggerSeam,
  type RunMode,
  type RunSummary,
  type Runtime,
  type RuntimeDeps,
  type RuntimeOptions,
} from "../runtime.ts";

import { fakeSettings, magpieListing, magpieProfile } from "./fixture.ts";

function fakeFetch(
  body: unknown,
  ok = true,
): { readonly fetchImpl: typeof fetch; readonly urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function logger(): LoggerSeam & { readonly warned: string[] } {
  const warned: string[] = [];
  return {
    warned,
    debug: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    warn: (message: string) => {
      warned.push(message);
    },
  };
}

const declarations = {
  magpie: {
    "ollama-cloud/kimi-k3": { low: "low", high: "high", max: "max" },
  },
} as const;

function options(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
  return {
    namespace: "llm-pi-ai",
    declarations: structuredClone(declarations),
    discover: true,
    discoverRoutes: [],
    ...overrides,
  };
}

function deps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return { logger: logger(), env: {}, ...overrides };
}

describe("createRuntime", () => {
  it("reports unavailable when no settings service is mounted", async () => {
    const runtime = createRuntime(options(), deps());
    const summary = await runtime.run("apply");
    expect(summary.result.kind).toBe("unavailable");
    expect(summary.probed).toEqual([]);
  });

  it("applies the row's explicit declarations without touching the network", async () => {
    const fake = fakeSettings(magpieProfile());
    const fetchSpy = vi.fn<typeof fetch>();
    const runtime = createRuntime(
      options(),
      deps({ settings: () => fake.seam, fetchImpl: fetchSpy }),
    );
    const summary = await runtime.run("apply");
    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(1);
  });

  it("plans without writing in status mode", async () => {
    const fake = fakeSettings(magpieProfile());
    const runtime = createRuntime(options(), deps({ settings: () => fake.seam }));
    const summary = await runtime.run("status");
    expect(summary.mode).toBe("status");
    expect(summary.result.kind).toBe("pending");
    expect(fake.calls).toEqual([]);
  });

  it("removes the declared fields in clear mode", async () => {
    const fake = fakeSettings(magpieProfile());
    await createRuntime(options(), deps({ settings: () => fake.seam })).run("apply");
    const summary = await createRuntime(options(), deps({ settings: () => fake.seam })).run(
      "clear",
    );
    expect(summary.result.kind).toBe("applied");
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]).not.toHaveProperty("reasoningEfforts");
  });

  it("discovers the endpoint's levels for the models the route declares", async () => {
    const fake = fakeSettings(magpieProfile());
    const { fetchImpl, urls } = fakeFetch(magpieListing());
    const runtime = createRuntime(
      options(),
      deps({
        settings: () => fake.seam,
        fetchImpl,
        env: { MAGPIE_API_KEY: "secret" },
      }),
    );
    const summary = await runtime.run("discover");
    expect(summary.probed).toEqual(["magpie"]);
    expect(summary.failures).toEqual([]);
    expect(urls).toEqual(["https://magpie.indexyz.me/v1/models"]);
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
    expect(providers.magpie.models[1]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
    expect(providers.magpie.models).toHaveLength(2);
  });

  it("keeps the row's declaration when the endpoint disagrees", async () => {
    const fake = fakeSettings(magpieProfile());
    const { fetchImpl } = fakeFetch(magpieListing());
    const runtime = createRuntime(
      options({
        declarations: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } },
      }),
      deps({ settings: () => fake.seam, fetchImpl, env: { MAGPIE_API_KEY: "secret" } }),
    );
    await runtime.run("discover");
    const providers = fake.state.user["providers"] as {
      magpie: { models: Array<Record<string, unknown>> };
    };
    expect(providers.magpie.models[0]?.["reasoningEfforts"]).toEqual({ low: "low" });
    expect(providers.magpie.models[1]?.["reasoningEfforts"]).toEqual({
      low: "low",
      high: "high",
      max: "max",
    });
  });

  it("contains a probe failure and still applies the declarations", async () => {
    const fake = fakeSettings(magpieProfile());
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error("dial tcp: connection refused");
    }) as unknown as typeof fetch;
    const runtime = createRuntime(
      options(),
      deps({ settings: () => fake.seam, fetchImpl, env: { MAGPIE_API_KEY: "secret" } }),
    );
    const summary = await runtime.run("discover");
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatch(/magpie: could not reach/);
    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes).toHaveLength(1);
  });

  it("reports a route whose protocol has no readable listing", async () => {
    const profile = magpieProfile();
    const providers = profile["providers"] as Record<string, Record<string, unknown>>;
    providers["magpie"] = { ...providers["magpie"], api: "google-generative-ai" };
    const fake = fakeSettings(profile);
    const runtime = createRuntime(options(), deps({ settings: () => fake.seam }));
    const summary = await runtime.run("discover");
    expect(summary.failures[0]).toMatch(/no model listing this build can read/);
  });

  it("interrogates the routes discoverRoutes names instead of the heuristic's", async () => {
    const profile = magpieProfile();
    const providers = profile["providers"] as Record<string, Record<string, unknown>>;
    providers["zero-aicoding-codex"] = {
      api: "openai-responses",
      baseURL: "https://aicoding.example/v1",
      apiKeyEnv: "ZERO_KEY",
      models: [{ id: "gpt-6-sol", name: "GPT-6-Sol" }],
    };
    const fake = fakeSettings(profile);
    const { fetchImpl, urls } = fakeFetch({
      data: [{ id: "gpt-6-sol", reasoning: true, reasoning_levels: ["high"] }],
    });
    const runtime = createRuntime(
      options({ declarations: {}, discoverRoutes: ["zero-aicoding-codex"] }),
      deps({ settings: () => fake.seam, fetchImpl, env: { ZERO_KEY: "k" } }),
    );
    const summary = await runtime.run("discover");
    expect(summary.probed).toEqual(["zero-aicoding-codex"]);
    expect(urls).toEqual(["https://aicoding.example/v1/models"]);
    const next = fake.state.user["providers"] as {
      "zero-aicoding-codex": { models: Array<Record<string, unknown>> };
    };
    expect(next["zero-aicoding-codex"].models[0]?.["reasoningEfforts"]).toEqual({ high: "high" });
  });

  it("prefers the credential store and falls back to the environment", async () => {
    const fake = fakeSettings(magpieProfile());
    const { fetchImpl, urls } = fakeFetch(magpieListing());
    const resolve = vi.fn<CredentialSeam["resolve"]>(async () => ({ value: "from-store" }));
    const runtime = createRuntime(
      options(),
      deps({ settings: () => fake.seam, fetchImpl, credentials: () => ({ resolve }), env: {} }),
    );
    await runtime.run("discover");
    expect(resolve).toHaveBeenCalledWith("MAGPIE_API_KEY");
    expect(urls).toHaveLength(1);
  });

  it("reports a credential-store failure and probes unauthenticated", async () => {
    const fake = fakeSettings(magpieProfile());
    const { fetchImpl, urls } = fakeFetch(magpieListing());
    const failure = logger();
    const resolve = vi.fn<CredentialSeam["resolve"]>(async () => {
      throw new Error("credential store unavailable");
    });
    const runtime = createRuntime(
      options(),
      deps({
        settings: () => fake.seam,
        fetchImpl,
        credentials: () => ({ resolve }),
        env: {},
        logger: failure,
      }),
    );
    const summary = await runtime.run("discover");
    expect(failure.warned[0]).toMatch(/could not resolve the credential MAGPIE_API_KEY/);
    expect(urls).toHaveLength(1);
    expect(summary.result.kind).toBe("applied");
  });

  it("does not probe a route the profile does not declare", async () => {
    const fake = fakeSettings({ providers: {} });
    const fetchSpy = vi.fn<typeof fetch>();
    const runtime = createRuntime(
      options({ declarations: { magpie: { x: { low: "low" } } } }),
      deps({ settings: () => fake.seam, fetchImpl: fetchSpy }),
    );
    const summary = await runtime.run("discover");
    expect(summary.probed).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(summary.result.skipped[0]?.reason).toMatch(/does not declare route "magpie"/);
  });
});

describe("runUntilAvailable", () => {
  function summaryOf(kind: "unavailable" | "applied"): RunSummary {
    return {
      mode: "apply",
      namespace: "llm-pi-ai",
      result: { kind, namespace: "llm-pi-ai", changes: [], skipped: [] },
      intents: 0,
      probed: [],
      failures: [],
    };
  }

  it("stops at the first reachable pass", async () => {
    const run = vi.fn<Runtime["run"]>(async () => summaryOf("applied"));
    const outcome = await runUntilAvailable({ run }, "apply", { sleep: async () => {} });
    expect(outcome.summary?.result.kind).toBe("applied");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries while the namespace is not reachable", async () => {
    let attempts = 0;
    const run = vi.fn<Runtime["run"]>(async () => {
      attempts += 1;
      return attempts < 3 ? summaryOf("unavailable") : summaryOf("applied");
    });
    const slept: number[] = [];
    const outcome = await runUntilAvailable({ run }, "apply", {
      attempts: 5,
      delayMs: 7,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(outcome.summary?.result.kind).toBe("applied");
    expect(run).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([7, 7]);
  });

  it("returns the last error when every attempt fails", async () => {
    const run = vi.fn<Runtime["run"]>(async () => {
      throw new Error("entry is no longer available");
    });
    const outcome = await runUntilAvailable({ run }, "apply", {
      attempts: 3,
      sleep: async () => {},
    });
    expect(outcome.summary).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Error);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt budget", async () => {
    const run = vi.fn<Runtime["run"]>(async () => summaryOf("unavailable"));
    const outcome = await runUntilAvailable({ run }, "apply", {
      attempts: 2,
      sleep: async () => {},
    });
    expect(outcome.summary?.result.kind).toBe("unavailable");
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("describeResult", () => {
  function summary(
    mode: RunMode,
    kind: "pending" | "applied" | "unchanged",
    extra: Partial<RunSummary> = {},
  ): RunSummary {
    return {
      mode,
      namespace: "llm-pi-ai",
      result: {
        kind,
        namespace: "llm-pi-ai",
        changes: [
          {
            route: "magpie",
            model: "ollama-cloud/kimi-k3",
            before: undefined,
            after: { low: "low", high: "high" },
          },
        ],
        skipped: [{ route: "magpie", model: "missing", reason: "not declared" }],
      },
      intents: 3,
      probed: [],
      failures: [],
      ...extra,
    };
  }

  it("renders a status answer with the pending pairs", () => {
    const text = describeResult(summary("status", "pending"));
    expect(text).toMatch(/1 pending change\(s\) for "llm-pi-ai" \(1 already current\)/);
    expect(text).toMatch(/magpie\/ollama-cloud\/kimi-k3 -> low\/high/);
    expect(text).toMatch(/skipped magpie\/missing: not declared/);
  });

  it("renders an applied answer", () => {
    expect(describeResult(summary("apply", "applied"))).toMatch(/applied 1 change\(s\)/);
  });

  it("renders an unchanged answer", () => {
    expect(describeResult(summary("apply", "unchanged"))).toMatch(/nothing to change/);
  });

  it("renders an unavailable answer", () => {
    const text = describeResult({
      mode: "apply",
      namespace: "llm-pi-ai",
      result: { kind: "unavailable", namespace: "llm-pi-ai", changes: [], skipped: [] },
      intents: 0,
      probed: [],
      failures: [],
    });
    expect(text).toMatch(/no configurable "llm-pi-ai" entry is mounted/);
  });

  it("renders discovery failures and an empty discovery", () => {
    const text = describeResult(
      summary("discover", "unchanged", {
        probed: ["magpie"],
        failures: ["magpie: could not reach"],
      }),
    );
    expect(text).toMatch(/discovery failed: magpie: could not reach/);
    const empty = describeResult(summary("discover", "unchanged"));
    expect(empty).toMatch(/nothing to interrogate/);
  });
});

describe("SettingsSeam typing", () => {
  it("keeps the fake usable as a seam", () => {
    const fake: SettingsSeam = fakeSettings(magpieProfile()).seam;
    expect(fake.describe()[0]?.ns).toBe("llm-pi-ai");
  });
});
