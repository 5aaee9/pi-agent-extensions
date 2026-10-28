import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import extension from "../index.ts";
import { DISCOVERY_CACHE_FILENAME, DISCOVERY_CACHE_TTL_MS } from "../model-cache.ts";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-model-cache-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

function writeConfig(value: unknown) {
  writeFileSync(join(stateDir, "sub2api.json"), JSON.stringify(value));
}

function cachePath() {
  return join(stateDir, DISCOVERY_CACHE_FILENAME);
}

function readCache() {
  return JSON.parse(readFileSync(cachePath(), "utf8")) as {
    version: number;
    providers: Record<
      string,
      { fetchedAt?: number; priceMultiplier?: number; models: Record<string, unknown>[] }
    >;
  };
}

type CommandHandler = (
  args: string,
  ctx: { ui: { notify: (message: string, level?: string) => void } },
) => Promise<void>;

async function load(route: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return route(url);
  });
  const providers = new Map<string, ProviderConfig>();
  const commands = new Map<string, CommandHandler>();
  await extension({
    registerProvider(name: string, config: ProviderConfig) {
      providers.set(name, config);
    },
    on() {},
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
  } as unknown as ExtensionAPI);
  return { calls, providers, commands };
}

function billing(url: string) {
  return url.endsWith("/sub2api/billing");
}

function discoveryUrl(url: string) {
  return url.endsWith("/v1/models") || url.endsWith("/backend-api/codex/models");
}

const codexConfig = {
  codex: {
    baseURL: "https://cache.example/v1",
    token: "sk-cache-secret",
    api: "openai-codex-responses",
  },
};

function codexManifest(models: unknown[]) {
  return (url: string) => {
    if (url === "https://cache.example/backend-api/codex/models") {
      return Response.json({ models });
    }
    return new Response(null, { status: 404 });
  };
}

const astra = {
  slug: "astra-preview",
  display_name: "Astra Preview",
  context_window: 262144,
  max_output_tokens: 64000,
  input_modalities: ["text", "image"],
  supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }, { effort: "high" }],
};

describe("discovered model cache", () => {
  it("reuses Codex manifest metadata without another remote discovery", async () => {
    writeConfig(codexConfig);
    const first = await load(codexManifest([astra]));
    expect(first.calls.filter(discoveryUrl)).toEqual([
      "https://cache.example/backend-api/codex/models",
    ]);
    expect(first.providers.get("codex")?.models?.[0]).toMatchObject({
      id: "astra-preview",
      name: "Astra Preview",
      contextWindow: 262144,
      maxTokens: 64000,
      input: ["text", "image"],
      reasoning: true,
      thinkingLevelMap: { low: "low", high: "high", max: "ultra" },
    });
    const cached = readCache();
    expect(cached.version).toBe(1);
    expect(cached.providers.codex?.fetchedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(cached.providers.codex?.priceMultiplier).toBe(1);
    expect(cached.providers.codex?.models[0]).toMatchObject({
      id: "astra-preview",
      contextWindow: 262144,
      maxTokens: 64000,
      supportedThinkingLevels: ["low", "high", "ultra"],
      reasoning: true,
      input: ["text", "image"],
    });
    expect(readFileSync(cachePath(), "utf8")).not.toContain("sk-cache-secret");
    expect(statSync(cachePath()).mode & 0o777).toBe(0o600);

    const second = await load((url) => {
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(second.calls.filter(discoveryUrl)).toEqual([]);
    expect(second.calls.some(billing)).toBe(false);
    expect(second.providers.get("codex")?.models?.[0]).toMatchObject({
      id: "astra-preview",
      contextWindow: 262144,
      maxTokens: 64000,
      thinkingLevelMap: { low: "low", high: "high", max: "ultra" },
    });
  });

  it("caches manifest enrichment for an automatic inventory", async () => {
    writeConfig({
      relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" },
    });
    const manifest = {
      slug: "gpt-5.6-sol",
      context_window: 200000,
      max_output_tokens: 32000,
      supported_reasoning_levels: ["medium", "high"],
    };
    const first = await load((url) => {
      if (url === "https://cache.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.6-sol" }] });
      }
      if (url === "https://cache.example/backend-api/codex/models") {
        return Response.json({ models: [manifest] });
      }
      return new Response(null, { status: 404 });
    });
    expect(first.calls.filter(discoveryUrl).sort()).toEqual([
      "https://cache.example/backend-api/codex/models",
      "https://cache.example/v1/models",
    ]);
    expect(readCache().providers.relay?.models[0]).toMatchObject({
      id: "gpt-5.6-sol",
      contextWindow: 200000,
      maxTokens: 32000,
      supportedThinkingLevels: ["medium", "high"],
    });

    const second = await load((url) => {
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(second.calls.filter(discoveryUrl)).toEqual([]);
    expect(second.providers.get("relay")?.models?.[0]).toMatchObject({
      id: "gpt-5.6-sol",
      contextWindow: 200000,
      maxTokens: 32000,
      thinkingLevelMap: { medium: "medium", high: "high" },
    });
  });

  it("caches xAI reasoning metadata separately from Pi's catalog", async () => {
    writeConfig({
      grok: { baseURL: "https://cache.example/v1", token: "sk-grok", api: "xai" },
    });
    const route = (url: string) => {
      if (url === "https://cache.example/v1/models") {
        return Response.json({
          data: [
            {
              id: "grok-custom",
              display_name: "Grok Custom",
              context_window: 128000,
              max_output_tokens: 8192,
              input_modalities: ["text"],
              supportsReasoningEffort: true,
              reasoningEfforts: [{ value: "high" }, { value: "low" }],
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
    await load(route);
    expect(readCache().providers.grok?.models[0]).toMatchObject({
      id: "grok-custom",
      contextWindow: 128000,
      maxTokens: 8192,
      input: ["text"],
      remoteMaxTokens: [8192],
      xaiReasoning: { supportsReasoningEffort: true, efforts: ["low", "high"] },
    });
    const second = await load((url) => {
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(second.providers.get("grok")?.models?.[0]).toMatchObject({
      id: "grok-custom",
      name: "Grok Custom",
      contextWindow: 128000,
      maxTokens: 8192,
      input: ["text"],
      reasoning: true,
      thinkingLevelMap: { low: "low", high: "high", medium: null },
    });
  });

  it("does not cache a failed discovery", async () => {
    writeConfig(codexConfig);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loaded = await load((url) => {
      if (url.endsWith("/backend-api/codex/models")) {
        return new Response("nope", { status: 503 });
      }
      return new Response(null, { status: 404 });
    });
    expect(loaded.providers.get("codex")?.models).toEqual([]);
    expect(existsSync(cachePath())).toBe(false);
  });

  it("ignores a cache entry when the endpoint or API no longer matches", async () => {
    writeConfig(codexConfig);
    await load(codexManifest([astra]));
    writeConfig({
      codex: {
        baseURL: "https://moved.example/v1",
        token: "sk-cache-secret",
        api: "openai-responses",
      },
    });
    const calls: string[] = [];
    const loaded = await load((url) => {
      calls.push(url);
      if (url === "https://moved.example/v1/models") {
        return Response.json({
          data: [{ id: "moved-model", context_window: 1000, max_tokens: 100 }],
        });
      }
      return new Response(null, { status: 404 });
    });
    expect(calls.filter(discoveryUrl)).toEqual(["https://moved.example/v1/models"]);
    expect(loaded.providers.get("codex")?.models?.map((model) => model.id)).toEqual([
      "moved-model",
    ]);
  });

  it("refetches when the cache file is unreadable", async () => {
    writeConfig(codexConfig);
    writeFileSync(cachePath(), "{");
    const loaded = await load(codexManifest([astra]));
    expect(loaded.calls.filter(discoveryUrl)).toEqual([
      "https://cache.example/backend-api/codex/models",
    ]);
    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("astra-preview");
  });

  it("refreshes registrations and keeps the previous cache when a relay fails", async () => {
    writeConfig({
      ...codexConfig,
      other: { baseURL: "https://other.example/v1", token: "sk-other", api: "openai-responses" },
    });
    let failCodex = false;
    const loaded = await load((url) => {
      if (url === "https://cache.example/backend-api/codex/models") {
        if (failCodex) return new Response(null, { status: 503 });
        return Response.json({ models: [astra] });
      }
      if (url === "https://other.example/v1/models") {
        return Response.json({
          data: [
            { id: failCodex ? "other-new" : "other-old", context_window: 4000, max_tokens: 400 },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });
    const before = readFileSync(cachePath(), "utf8");
    failCodex = true;
    const notify = vi.fn<(message: string, level?: string) => void>();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await loaded.commands.get("sub2api-refresh")!("", { ui: { notify } });

    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("astra-preview");
    expect(loaded.providers.get("other")?.models?.[0]?.id).toBe("other-new");
    const cached = readCache();
    expect(cached.providers.codex?.models[0]?.id).toBe("astra-preview");
    expect(cached.providers.other?.models[0]?.id).toBe("other-new");
    expect(readFileSync(cachePath(), "utf8")).not.toBe(before);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Kept the last cached models"),
      "error",
    );
    expect(notify.mock.calls[0]?.[0]).toContain("codex: HTTP 503");
    expect(notify.mock.calls[0]?.[0]).toContain("other (1)");
  });

  function writeCodexCache(id: string, fetchedAt?: number) {
    writeFileSync(
      cachePath(),
      JSON.stringify({
        version: 1,
        providers: {
          codex: {
            baseUrl: "https://cache.example/v1",
            api: "openai-codex-responses",
            xai: false,
            ...(fetchedAt === undefined ? {} : { fetchedAt }),
            models: [
              {
                id,
                name: id,
                contextWindow: 1000,
                maxTokens: 100,
                reasoning: false,
                input: ["text"],
                supportedThinkingLevels: [],
              },
            ],
          },
        },
      }),
    );
  }

  it("keeps a cache younger than 12 hours without discovery", async () => {
    writeConfig(codexConfig);
    writeCodexCache("cached-old", Date.now() - DISCOVERY_CACHE_TTL_MS + 60_000);
    const loaded = await load((url) => {
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("cached-old");
    expect(loaded.calls.filter(discoveryUrl)).toEqual([]);
    await vi.waitFor(() => {
      expect(readCache().providers.codex?.priceMultiplier).toBe(1);
    });
  });

  it.each([
    {
      label: "12 hours old",
      fetchedAt: () => Date.now() - DISCOVERY_CACHE_TTL_MS,
    },
    {
      label: "missing a timestamp",
      fetchedAt: () => undefined,
    },
  ])("registers a cache that is $label immediately, then refreshes it", async ({ fetchedAt }) => {
    writeConfig(codexConfig);
    const previousFetchedAt = fetchedAt();
    writeCodexCache("cached-old", previousFetchedAt);
    let releaseDiscovery: (() => void) | undefined;
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const loaded = await load(async (url) => {
      if (url === "https://cache.example/backend-api/codex/models") {
        await discoveryGate;
        return Response.json({ models: [astra] });
      }
      return new Response(null, { status: 404 });
    });

    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("cached-old");
    expect(loaded.calls.filter(discoveryUrl)).toEqual([
      "https://cache.example/backend-api/codex/models",
    ]);
    releaseDiscovery?.();
    await vi.waitFor(() => {
      expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("astra-preview");
    });
    expect(readCache().providers.codex?.fetchedAt).toBeGreaterThan(
      previousFetchedAt ?? Date.now() - 60_000,
    );
  });

  it("keeps an expired cache when the background refresh fails", async () => {
    writeConfig(codexConfig);
    const fetchedAt = Date.now() - DISCOVERY_CACHE_TTL_MS - 5;
    writeCodexCache("cached-old", fetchedAt);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loaded = await load((url) => {
      if (url.endsWith("/backend-api/codex/models")) return new Response(null, { status: 503 });
      return new Response(null, { status: 404 });
    });
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("background model refresh kept the last cached models"),
      );
    });
    expect(readCache().providers.codex?.fetchedAt).toBe(fetchedAt);
    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("cached-old");
  });

  it("forces a refresh from /sub2api-refresh while the cache is fresh", async () => {
    writeConfig(codexConfig);
    let manifest = [astra];
    const loaded = await load((url) => {
      if (url === "https://cache.example/backend-api/codex/models") {
        return Response.json({ models: manifest });
      }
      return new Response(null, { status: 404 });
    });
    expect(loaded.calls.filter(discoveryUrl)).toHaveLength(1);
    manifest = [{ ...astra, slug: "forced-preview", display_name: "Forced" }];
    const notify = vi.fn<(message: string, level?: string) => void>();
    await loaded.commands.get("sub2api-refresh")!("", { ui: { notify } });
    expect(loaded.calls.filter(discoveryUrl)).toHaveLength(2);
    expect(loaded.providers.get("codex")?.models?.[0]?.id).toBe("forced-preview");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("codex (1)"), "info");
  });

  function writePriceCache(priceMultiplier?: number, fetchedAt = Date.now()) {
    writeFileSync(
      cachePath(),
      JSON.stringify({
        version: 1,
        providers: {
          relay: {
            baseUrl: "https://cache.example/v1",
            xai: false,
            fetchedAt,
            ...(priceMultiplier === undefined ? {} : { priceMultiplier }),
            models: [
              {
                id: "gpt-5.5",
                name: "GPT-5.5",
                contextWindow: 1000,
                maxTokens: 100,
                reasoning: true,
                input: ["text"],
                supportedThinkingLevels: ["high"],
              },
            ],
          },
        },
      }),
    );
  }

  function billingContract(multiplier: number) {
    return {
      object: "sub2api.key_billing",
      schema_version: 1,
      billing_scope: "token",
      group_rate_multiplier: multiplier,
      resolved_rate_multiplier: multiplier,
      peak_rate_enabled: false,
      effective_rate_multiplier: multiplier,
    };
  }

  it("stores the billing multiplier with the model cache and skips it while fresh", async () => {
    writeConfig({ relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" } });
    const first = await load((url) => {
      if (url === "https://cache.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.5", display_name: "GPT-5.5" }] });
      }
      if (url === "https://cache.example/v1/sub2api/billing") {
        return Response.json(billingContract(0.5));
      }
      return new Response(null, { status: 404 });
    });
    expect(first.providers.get("relay")?.models?.[0]?.cost.input).toBe(2.5);
    expect(readCache().providers.relay?.priceMultiplier).toBe(0.5);

    const second = await load((url) => {
      if (discoveryUrl(url) || billing(url)) throw new Error(`unexpected remote request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(second.calls.filter((url) => discoveryUrl(url) || billing(url))).toEqual([]);
    expect(second.providers.get("relay")?.models?.[0]?.cost.input).toBe(2.5);
  });

  it("does not request billing while the cached multiplier is fresh", async () => {
    writeConfig({ relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" } });
    writePriceCache(0.4, Date.now() - DISCOVERY_CACHE_TTL_MS + 60_000);
    let releaseBilling: (() => void) | undefined;
    const billingGate = new Promise<void>((resolve) => {
      releaseBilling = resolve;
    });
    const loaded = await load(async (url) => {
      if (billing(url)) await billingGate;
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(loaded.providers.get("relay")?.models?.[0]?.cost.input).toBe(2);
    expect(loaded.calls.some(billing)).toBe(false);
    releaseBilling?.();
  });

  it("loads a cached model list immediately and applies billing when the multiplier is missing", async () => {
    writeConfig({ relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" } });
    writePriceCache(undefined, Date.now());
    let releaseBilling: (() => void) | undefined;
    const billingGate = new Promise<void>((resolve) => {
      releaseBilling = resolve;
    });
    const loaded = await load(async (url) => {
      if (billing(url)) {
        await billingGate;
        return Response.json(billingContract(0.25));
      }
      if (discoveryUrl(url)) throw new Error(`unexpected discovery request ${url}`);
      return new Response(null, { status: 404 });
    });
    expect(loaded.providers.get("relay")?.models?.[0]?.cost.input).toBe(5);
    expect(loaded.calls.filter(billing)).toEqual(["https://cache.example/v1/sub2api/billing"]);
    releaseBilling?.();
    await vi.waitFor(() => {
      expect(loaded.providers.get("relay")?.models?.[0]?.cost.input).toBe(1.25);
    });
    expect(readCache().providers.relay?.priceMultiplier).toBe(0.25);
    expect(readCache().providers.relay?.models[0]?.id).toBe("gpt-5.5");
  });

  it("keeps the cached multiplier when a background billing refresh fails", async () => {
    writeConfig({ relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" } });
    const fetchedAt = Date.now() - DISCOVERY_CACHE_TTL_MS;
    writePriceCache(0.4, fetchedAt);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loaded = await load((url) => {
      if (url === "https://cache.example/v1/models") {
        return Response.json({
          data: [{ id: "gpt-5.5", display_name: "GPT-5.5", context_window: 1111 }],
        });
      }
      if (billing(url)) return new Response(null, { status: 503 });
      return new Response(null, { status: 404 });
    });
    await vi.waitFor(() => {
      expect(loaded.providers.get("relay")?.models?.[0]).toMatchObject({ contextWindow: 1111 });
    });
    expect(loaded.providers.get("relay")?.models?.[0]).toMatchObject({ cost: { input: 2 } });
    expect(readCache().providers.relay?.priceMultiplier).toBe(0.4);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Kept the last cached price multiplier"),
      );
    });
  });

  it("forces a billing refresh from /sub2api-refresh while the multiplier is fresh", async () => {
    writeConfig({ relay: { baseURL: "https://cache.example/v1", token: "sk-cache-secret" } });
    let multiplier = 0.5;
    const loaded = await load((url) => {
      if (url === "https://cache.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.5", display_name: "GPT-5.5" }] });
      }
      if (billing(url)) return Response.json(billingContract(multiplier));
      return new Response(null, { status: 404 });
    });
    expect(loaded.calls.filter(billing)).toHaveLength(1);
    multiplier = 0.25;
    const notify = vi.fn<(message: string, level?: string) => void>();
    await loaded.commands.get("sub2api-refresh")!("", { ui: { notify } });
    expect(loaded.calls.filter(billing)).toHaveLength(2);
    expect(loaded.providers.get("relay")?.models?.[0]?.cost.input).toBe(1.25);
    expect(readCache().providers.relay?.priceMultiplier).toBe(0.25);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("relay (1)"), "info");
  });
});
