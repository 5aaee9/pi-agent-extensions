import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";

interface Registration {
  name: string;
  config: ProviderConfig;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-model-metadata-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("model metadata discovery", () => {
  it("merges Codex manifest limits, uses API-specific catalog fallbacks, and keeps standard inventory authoritative", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({
        auto: { baseURL: "https://auto.example", token: "sk-auto" },
        responses: {
          baseURL: "https://responses-metadata.example/v1",
          token: "sk-responses",
          api: "openai-responses",
        },
      }),
    );

    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });

      if (url === "https://auto.example/v1/models") {
        return Response.json({
          data: [
            { id: "gpt-5.5" },
            { id: "gpt-5.6" },
            { id: "gpt-5.3-codex-spark" },
            { id: "codex-auto-review" },
            { id: "codex-manifest-output" },
            { id: "codex-cross-field", context_window: 100000, max_tokens: 150000 },
            { id: "gpt-5.6-terra", context_window: 260000, max_tokens: 64000 },
            {
              id: "grok-valid-later-aliases",
              context_window: 0,
              max_context_tokens: 122000,
              max_tokens: "",
              max_output_tokens: 12000,
            },
          ],
        });
      }
      if (url === "https://auto.example/backend-api/codex/models") {
        return Response.json({
          models: [
            {
              slug: "gpt-5.5",
              context_window: 272000,
              supported_reasoning_levels: [
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
                { effort: "xhigh" },
                { effort: "max" },
              ],
            },
            { slug: "gpt-5.6", max_tokens: 0, supported_reasoning_levels: ["unknown"] },
            {
              slug: "gpt-5.6-sol",
              context_window: 272000,
              max_output_tokens: 96000,
              supported_reasoning_levels: [
                { effort: " low " },
                { effort: "medium" },
                { effort: "high" },
                { effort: "xhigh" },
                { effort: "max" },
                { effort: "ultra" },
                { effort: "ULTRA" },
              ],
            },
            { slug: "gpt-5.3-codex-spark", context_window: 128000 },
            { slug: "codex-auto-review", context_window: 272000 },
            {
              slug: "codex-manifest-output",
              context_window: 100000,
              max_tokens: 0,
              max_output_tokens: 50000,
            },
            { slug: "codex-cross-field", context_window: 100000, max_output_tokens: 50000 },
            { slug: "gpt-5.6-terra", context_window: 272000 },
            { slug: "gpt-5.4", context_window: 272000 },
          ],
        });
      }
      if (url === "https://responses-metadata.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.3-codex-spark" }] });
      }
      if (url === "https://responses-metadata.example/backend-api/codex/models") {
        return Response.json({
          models: [{ slug: "gpt-5.3-codex-spark", context_window: 128000 }],
        });
      }
      if (url === "https://auto.example/v1/sub2api/billing") {
        return Response.json({
          object: "sub2api.key_billing",
          schema_version: 2,
          billing_scope: "token",
          group_rate_multiplier: 1,
          resolved_rate_multiplier: 0.01,
          peak_rate_enabled: false,
          effective_rate_multiplier: 0.01,
        });
      }
      return new Response(null, { status: 404 });
    });

    const registrations: Registration[] = [];
    await extension({
      registerProvider(name: string, config: ProviderConfig) {
        registrations.push({ name, config });
      },
      on() {},
      registerCommand() {},
    } as unknown as ExtensionAPI);

    const autoModels = registrations.find(({ name }) => name === "auto")!.config.models!;
    expect(autoModels.map(({ id }) => id)).toEqual([
      "gpt-5.5",
      "gpt-5.6",
      "gpt-5.3-codex-spark",
      "codex-auto-review",
      "codex-manifest-output",
      "codex-cross-field",
      "gpt-5.6-terra",
      "grok-valid-later-aliases",
    ]);
    expect(autoModels.map(({ contextWindow, maxTokens }) => [contextWindow, maxTokens])).toEqual([
      [272000, 128000],
      [272000, 96000],
      [128000, 128000],
      [272000, 16384],
      [100000, 50000],
      [100000, 50000],
      [260000, 64000],
      [122000, 12000],
    ]);
    expect(autoModels[0]!.cost.input).toBe(5);
    expect(autoModels[0]!.thinkingLevelMap).toEqual({
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    expect(autoModels[1]!.thinkingLevelMap).toEqual({
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "ultra",
    });

    const responsesModel = registrations.find(({ name }) => name === "responses")!.config
      .models![0]!;
    expect(responsesModel).toMatchObject({
      api: "openai-responses",
      contextWindow: 128000,
      maxTokens: 32000,
    });

    expect(calls.map(({ url }) => url).sort()).toEqual(
      [
        "https://auto.example/v1/models",
        "https://auto.example/backend-api/codex/models",
        "https://auto.example/v1/sub2api/billing",
        "https://responses-metadata.example/v1/models",
        "https://responses-metadata.example/backend-api/codex/models",
        "https://responses-metadata.example/v1/sub2api/billing",
      ].sort(),
    );
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("authorization")).toMatch(/^Bearer sk-/);
      expect(call.init?.redirect).toBe("error");
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps catalog-backed models when the optional Codex manifest endpoint is absent", async () => {
    writeFileSync(
      join(stateDir, "sub2api.json"),
      JSON.stringify({ unavailable: { baseURL: "https://no-manifest.example", token: "sk" } }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url === "https://no-manifest.example/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.5" }] });
      }
      return new Response(null, { status: 404 });
    });

    const registrations: Registration[] = [];
    await extension({
      registerProvider(name: string, config: ProviderConfig) {
        registrations.push({ name, config });
      },
      on() {},
      registerCommand() {},
    } as unknown as ExtensionAPI);

    expect(calls.sort()).toEqual(
      [
        "https://no-manifest.example/v1/models",
        "https://no-manifest.example/backend-api/codex/models",
        "https://no-manifest.example/v1/sub2api/billing",
      ].sort(),
    );
    expect(registrations[0]!.config.models![0]).toMatchObject({
      id: "gpt-5.5",
      contextWindow: 272000,
      maxTokens: 128000,
      cost: {
        input: 5,
        output: 30,
        cacheRead: 0.5,
        cacheWrite: 0,
        tiers: [
          {
            inputTokensAbove: 272000,
            input: 10,
            output: 45,
            cacheRead: 1,
            cacheWrite: 0,
          },
        ],
      },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
