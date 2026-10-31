import { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";

import type { SettingsSeam } from "../apply.ts";
import {
  createRuntime,
  describeResult,
  runUntilAvailable,
  type RunMode,
  type RunSummary,
  type Runtime,
  type RuntimeDeps,
  type RuntimeOptions,
} from "../runtime.ts";

import {
  codexInventory,
  codexManifest,
  codexProviders,
  createHost,
  isolateCredentialEnvironment,
  magpieListing,
  magpieProviders,
  modelField,
  REFUSED_ORIGIN,
  routeModels,
  routeProviders,
  setEnvironment,
  startServer,
  visionListing,
} from "./fixture.ts";

const declarations = {
  magpie: {
    "ollama-cloud/kimi-k3": { low: "low", high: "high", max: "max" },
  },
};

function options(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
  return {
    namespace: "llm-pi-ai",
    declarations: structuredClone(declarations),
    inputs: {},
    discover: true,
    discoverRoutes: [],
    ...overrides,
  };
}

function deps(ctx: Context, overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return { logger: ctx.logger, ...overrides };
}

describe("createRuntime on the real settings plane", () => {
  beforeEach(isolateCredentialEnvironment);

  it("reports unavailable when no settings service is mounted", async () => {
    const ctx = new Context();
    onTestFinished(async () => {
      await ctx.fiber.dispose();
    });
    const runtime = createRuntime(options(), deps(ctx));
    const summary = await runtime.run("apply");

    expect(summary.result.kind).toBe("unavailable");
    expect(summary.probed).toEqual([]);
  });

  it("applies the row's explicit declarations without touching the network", async () => {
    const server = await startServer({});
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    const summary = await runtime.run("apply");

    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes).toHaveLength(1);
    expect(server.requests).toEqual([]);
    expect(host.providers()?.["magpie"]).toBeDefined();
  });

  it("plans without writing in status mode", async () => {
    const host = await createHost();
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    const summary = await runtime.run("status");

    expect(summary.mode).toBe("status");
    expect(summary.result.kind).toBe("pending");
    expect(await host.readPatch()).not.toContain("reasoningEfforts");
  });

  it("removes the declared fields in clear mode", async () => {
    const host = await createHost();
    await createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings })).run(
      "apply",
    );
    const summary = await createRuntime(
      options(),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    ).run("clear");

    expect(summary.result.kind).toBe("applied");
    expect(
      modelField(host.providers(), "magpie", "ollama-cloud/kimi-k3", "reasoningEfforts"),
    ).toBeUndefined();
  });

  it("discovers the endpoint's levels for the models the route declares", async () => {
    const server = await startServer({ "/v1/models": { body: magpieListing() } });
    setEnvironment("MAGPIE_API_KEY", "secret");
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    const summary = await runtime.run("discover");

    expect(summary.probed).toEqual(["magpie"]);
    expect(summary.failures).toEqual([]);
    expect(server.requests.map((request) => request.url)).toEqual(["/v1/models"]);
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer secret");
    const models = routeModels(host.providers(), "magpie");
    expect(models[0]?.["reasoningEfforts"]).toEqual({ low: "low", high: "high", max: "max" });
    expect(models[1]?.["reasoningEfforts"]).toEqual({ low: "low", high: "high", max: "max" });
    expect(models).toHaveLength(2);
  });

  it("keeps the row's declaration when the endpoint disagrees", async () => {
    const server = await startServer({ "/v1/models": { body: magpieListing() } });
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(
      options({ declarations: { magpie: { "ollama-cloud/kimi-k3": { low: "low" } } } }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    await runtime.run("discover");

    const models = routeModels(host.providers(), "magpie");
    expect(models[0]?.["reasoningEfforts"]).toEqual({ low: "low" });
    expect(models[1]?.["reasoningEfforts"]).toEqual({ low: "low", high: "high", max: "max" });
  });

  it("discovers the modalities a listing publishes for a declared vision model", async () => {
    const server = await startServer({ "/v1/models": { body: visionListing() } });
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes.map((change) => change.field)).toEqual(["input"]);
    const models = routeModels(host.providers(), "magpie");
    expect(models[0]?.["input"]).toEqual(["text", "image"]);
    expect(models[1]?.["input"]).toBeUndefined();
    expect(summary.result.skipped).toEqual([]);
  });

  it("writes nothing for a listing that publishes text only", async () => {
    const server = await startServer({
      "/v1/models": {
        body: { data: [{ id: "ollama-cloud/kimi-k3", input_modalities: ["text"] }] },
      },
    });
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.result.kind).toBe("unchanged");
    const models = routeModels(host.providers(), "magpie");
    expect(models[0]?.["input"]).toEqual(["text"]);
  });

  it("prefers an explicit vision declaration over a discovered one", async () => {
    const server = await startServer({ "/v1/models": { body: visionListing() } });
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(
      options({ declarations: {}, inputs: { magpie: { "ollama-cloud/kimi-k3": ["text"] } } }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.result.kind).toBe("unchanged");
    const models = routeModels(host.providers(), "magpie");
    expect(models[0]?.["input"]).toEqual(["text"]);
  });

  it("removes the vision table's input field in clear mode", async () => {
    const host = await createHost();
    const inputs = { magpie: { "ollama-cloud/kimi-k3": ["text", "image"] as const } };
    await createRuntime(
      options({ declarations: {}, inputs }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    ).run("apply");
    const summary = await createRuntime(
      options({ declarations: {}, inputs }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    ).run("clear");

    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes.map((change) => change.field)).toEqual(["input"]);
    const models = routeModels(host.providers(), "magpie");
    expect(models[0]).not.toHaveProperty("input");
  });

  it("contains a probe failure and still applies the declarations", async () => {
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${REFUSED_ORIGIN}/v1` }),
    });
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    const summary = await runtime.run("discover");

    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatch(/magpie: could not reach/);
    expect(summary.result.kind).toBe("applied");
    expect(summary.result.changes).toHaveLength(1);
  });

  it("reports a route whose protocol has no readable listing", async () => {
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { api: "google-generative-ai" }),
    });
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    const summary = await runtime.run("discover");

    expect(summary.failures[0]).toMatch(/no model listing this build can read/);
  });

  it("interrogates the routes discoverRoutes names instead of the heuristic's", async () => {
    const server = await startServer({
      "/v1/models": {
        body: { data: [{ id: "gpt-6-sol", reasoning: true, reasoning_levels: ["high"] }] },
      },
    });
    const providers = routeProviders(codexProviders(), "zero-aicoding-codex", {
      baseURL: `${server.url}/v1`,
      models: [{ id: "gpt-6-sol", name: "GPT-6-Sol" }],
    });
    setEnvironment("ZERO_AICODING_CODEX_API_KEY", "k");
    const host = await createHost({ providers });
    const runtime = createRuntime(
      options({ declarations: {}, discoverRoutes: ["zero-aicoding-codex"] }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.probed).toEqual(["zero-aicoding-codex"]);
    expect(server.requests.map((request) => request.url)).toEqual(["/v1/models"]);
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer k");
    const models = routeModels(host.providers(), "zero-aicoding-codex");
    expect(models[0]?.["reasoningEfforts"]).toEqual({ high: "high" });
  });

  it("probes unauthenticated when the environment resolves no credential", async () => {
    const server = await startServer({ "/v1/models": { body: magpieListing() } });
    setEnvironment("MAGPIE_API_KEY", undefined);
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(options(), deps(host.ctx, { settings: () => host.ctx.settings }));
    await runtime.run("discover");

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers["authorization"]).toBeUndefined();
  });

  it("resolves the route's credential through the real store before the environment", async () => {
    const server = await startServer({ "/v1/models": { body: magpieListing() } });
    setEnvironment("MAGPIE_API_KEY", "from-env");
    const host = await createHost({
      credentials: true,
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const ref = credentialRef("MAGPIE_API_KEY");
    await host.ctx.credentials.set(ref, "from-store");

    // The plugin's own command resolves `ctx.credentials` from the real graph.
    const stored = await host.run("discover");
    expect(stored.kind).toBe("success");
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer from-store");

    // Removing the stored value lets the real store's environment layer answer.
    await host.ctx.credentials.unset(ref);
    await host.run("discover");
    expect(server.requests.map((request) => request.headers["authorization"])).toEqual([
      "Bearer from-store",
      "Bearer from-env",
    ]);
  });

  // Boundary: runtime.ts `resolveApiKey` also handles a credential-store
  // rejection ("could not resolve the credential …", then an unauthenticated
  // probe). The only CredentialProvider in this package's pinned closure,
  // `@deepseek-ai/dsh-credentials-local` 0.2.2-alpha.2, never rejects
  // `resolve()` (a stored-map lookup over the launch environment; an invalid
  // document fails the provider's boot, which leaves the service absent and
  // the plugin on its environment path), so that branch is unreachable through
  // the real store and is deliberately not asserted with a stand-in.

  it("does not probe a route the profile does not declare", async () => {
    const server = await startServer({});
    const host = await createHost({ providers: {} });
    const runtime = createRuntime(
      options({ declarations: { magpie: { x: { low: "low" } } } }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.probed).toEqual([]);
    expect(server.requests).toEqual([]);
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
    let calls = 0;
    const run: Runtime = {
      run: async () => {
        calls += 1;
        return summaryOf("applied");
      },
    };
    const outcome = await runUntilAvailable(run, "apply", { sleep: async () => {} });

    expect(outcome.summary?.result.kind).toBe("applied");
    expect(calls).toBe(1);
  });

  it("retries while the namespace is not reachable", async () => {
    let calls = 0;
    const run: Runtime = {
      run: async () => {
        calls += 1;
        return calls < 3 ? summaryOf("unavailable") : summaryOf("applied");
      },
    };
    const slept: number[] = [];
    const outcome = await runUntilAvailable(run, "apply", {
      attempts: 5,
      delayMs: 7,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(outcome.summary?.result.kind).toBe("applied");
    expect(calls).toBe(3);
    expect(slept).toEqual([7, 7]);
  });

  it("returns the last error when every attempt fails", async () => {
    let calls = 0;
    const run: Runtime = {
      run: async () => {
        calls += 1;
        throw new Error("entry is no longer available");
      },
    };
    const outcome = await runUntilAvailable(run, "apply", {
      attempts: 3,
      sleep: async () => {},
    });

    expect(outcome.summary).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Error);
    expect(calls).toBe(3);
  });

  it("gives up after the attempt budget", async () => {
    let calls = 0;
    const run: Runtime = {
      run: async () => {
        calls += 1;
        return summaryOf("unavailable");
      },
    };
    const outcome = await runUntilAvailable(run, "apply", {
      attempts: 2,
      sleep: async () => {},
    });

    expect(outcome.summary?.result.kind).toBe("unavailable");
    expect(calls).toBe(2);
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
            field: "reasoningEfforts",
            route: "magpie",
            model: "ollama-cloud/kimi-k3",
            before: undefined,
            after: { low: "low", high: "high" },
          },
        ],
        skipped: [
          { field: "reasoningEfforts", route: "magpie", model: "missing", reason: "not declared" },
        ],
      },
      intents: 3,
      probed: [],
      failures: [],
      ...extra,
    };
  }

  it("renders both fields' changes and skips in one answer", () => {
    const text = describeResult({
      mode: "status",
      namespace: "llm-pi-ai",
      result: {
        kind: "pending",
        namespace: "llm-pi-ai",
        changes: [
          {
            field: "reasoningEfforts",
            route: "magpie",
            model: "ollama-cloud/kimi-k3",
            before: undefined,
            after: { low: "low" },
          },
          {
            field: "input",
            route: "magpie",
            model: "ollama-cloud/kimi-k3",
            before: ["text"],
            after: ["text", "image"],
          },
        ],
        skipped: [{ field: "input", route: "magpie", model: "missing", reason: "not declared" }],
      },
      intents: 3,
      probed: [],
      failures: [],
    });
    expect(text).toMatch(/magpie\/ollama-cloud\/kimi-k3 reasoningEfforts -> low/);
    expect(text).toMatch(/magpie\/ollama-cloud\/kimi-k3 input -> text\/image/);
    expect(text).toMatch(/skipped magpie\/missing input: not declared/);
    expect(text).toMatch(/2 pending change\(s\).*\(0 already current\)/);
  });

  it("renders a discovered metadata change", () => {
    const text = describeResult({
      mode: "discover",
      namespace: "llm-pi-ai",
      result: {
        kind: "applied",
        namespace: "llm-pi-ai",
        changes: [
          {
            field: "contextWindow",
            route: "zero-aicoding-codex",
            model: "gpt-6.1-sol",
            before: undefined,
            after: 500000,
          },
        ],
        skipped: [],
      },
      intents: 1,
      probed: ["zero-aicoding-codex"],
      failures: [],
    });
    expect(text).toMatch(/zero-aicoding-codex\/gpt-6.1-sol contextWindow -> 500000/);
  });

  it("renders a vision removal", () => {
    const text = describeResult({
      mode: "clear",
      namespace: "llm-pi-ai",
      result: {
        kind: "applied",
        namespace: "llm-pi-ai",
        changes: [
          {
            field: "input",
            route: "magpie",
            model: "ollama-cloud/kimi-k3",
            before: ["text", "image"],
            after: undefined,
          },
        ],
        skipped: [],
      },
      intents: 1,
      probed: [],
      failures: [],
    });
    expect(text).toMatch(/magpie\/ollama-cloud\/kimi-k3 input -> removed/);
  });

  it("renders a status answer with the pending pairs", () => {
    const text = describeResult(summary("status", "pending"));
    expect(text).toMatch(/1 pending change\(s\) for "llm-pi-ai" \(1 already current\)/);
    expect(text).toMatch(/magpie\/ollama-cloud\/kimi-k3 reasoningEfforts -> low\/high/);
    expect(text).toMatch(/skipped magpie\/missing reasoningEfforts: not declared/);
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
  it("accepts the real settings service as the seam", async () => {
    const host = await createHost();
    const seam: SettingsSeam = host.ctx.settings;
    expect(seam.describe()[0]?.ns).toBe("llm-pi-ai");
  });
});

describe("Codex manifest discovery over real HTTP", () => {
  beforeEach(isolateCredentialEnvironment);

  const INVENTORY = "/v1/models";
  const MANIFEST = "/backend-api/codex/models";

  it("fills a route whose inventory publishes no levels from its manifest", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { body: codexManifest() },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(server.requests.map((request) => request.url)).toEqual([INVENTORY, MANIFEST]);
    expect(summary.failures).toEqual([]);
    const models = routeModels(host.providers(), "zero-aicoding-codex");
    expect(models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    expect(models[1]?.["reasoningEfforts"]).toEqual({
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    expect(models[2]).not.toHaveProperty("reasoningEfforts");
    expect(summary.result.changes).toHaveLength(2);
  });

  it("fills a declared model's context window from the manifest", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { body: codexManifest() },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
        models: [{ id: "gpt-6.1-sol", name: "GPT-6.1-Sol" }],
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.failures).toEqual([]);
    const models = routeModels(host.providers(), "zero-aicoding-codex");
    expect(models[0]?.["contextWindow"]).toBe(500000);
    expect(summary.result.changes.map((change) => change.field)).toContain("contextWindow");
  });

  it("does not overwrite the profile's own context window", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { body: codexManifest() },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.result.changes.some((change) => change.field === "contextWindow")).toBe(false);
    const models = routeModels(host.providers(), "zero-aicoding-codex");
    expect(models[0]?.["contextWindow"]).toBe(256000);
  });

  it("keeps the manifest's spellings when the listing described few levels", async () => {
    const server = await startServer({
      [INVENTORY]: {
        body: {
          data: [
            {
              id: "gpt-6.1-sol",
              reasoning: true,
              supported_reasoning_levels: [{ effort: "low" }],
            },
            { id: "gpt-6-luna" },
          ],
        },
      },
      [MANIFEST]: { body: codexManifest() },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    await runtime.run("discover");

    const models = routeModels(host.providers(), "zero-aicoding-codex");
    expect(models[0]?.["reasoningEfforts"]).toEqual({
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
  });

  it("does not ask for a manifest when the listing described every declared model", async () => {
    const server = await startServer({ [INVENTORY]: { body: magpieListing() } });
    const host = await createHost({
      providers: routeProviders(magpieProviders(), "magpie", { baseURL: `${server.url}/v1` }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(server.requests).toHaveLength(1);
    expect(summary.result.kind).toBe("applied");
  });

  it("treats a relay without the endpoint as having nothing more to say", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { status: 403, body: "<html>forbidden</html>" },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(server.requests.map((request) => request.url)).toEqual([INVENTORY, MANIFEST]);
    expect(summary.failures).toEqual([]);
    expect(summary.result.kind).toBe("unchanged");
  });

  it("reports a manifest the endpoint failed to serve", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { status: 500, body: {} },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    const summary = await runtime.run("discover");

    expect(summary.failures[0]).toMatch(/backend-api\/codex\/models answered 500/);
  });

  it("does not consult a manifest for another protocol", async () => {
    const server = await startServer({
      [INVENTORY]: { body: codexInventory() },
      [MANIFEST]: { body: codexManifest() },
    });
    const host = await createHost({
      providers: routeProviders(codexProviders(), "zero-aicoding-codex", {
        baseURL: `${server.url}/v1`,
        api: "openai-completions",
      }),
    });
    const runtime = createRuntime(
      options({ declarations: {} }),
      deps(host.ctx, { settings: () => host.ctx.settings }),
    );
    await runtime.run("discover");

    expect(server.requests.map((request) => request.url)).toEqual([INVENTORY]);
  });
});
