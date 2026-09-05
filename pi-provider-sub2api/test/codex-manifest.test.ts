import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";

const root = "https://codex-manifest.example";
let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-codex-manifest-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
  writeFileSync(
    join(stateDir, "sub2api.json"),
    JSON.stringify({
      codex: { baseURL: `${root}/v1`, token: "sk-manifest", api: "openai-codex-responses" },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

async function registerProvider() {
  const registrations: ProviderConfig[] = [];
  await extension({
    registerProvider(_name: string, config: ProviderConfig) {
      registrations.push(config);
    },
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI);
  expect(registrations).toHaveLength(1);
  return registrations[0]!;
}

describe("explicit Codex manifest discovery", () => {
  it("registers manifest names and capabilities without requesting the standard inventory", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      if (url === `${root}/backend-api/codex/models`) {
        return Response.json({
          models: [
            {
              slug: "astra-preview",
              display_name: "Astra Preview",
              context_window: 262144,
              max_output_tokens: 64000,
              input_modalities: ["text"],
              supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }],
            },
          ],
        });
      }
      if (url === `${root}/v1/models`) {
        return Response.json({ data: [{ id: "inventory-only" }] });
      }
      return new Response(null, { status: 404 });
    });

    const provider = await registerProvider();
    expect(calls.map(({ url }) => url).sort()).toEqual([
      `${root}/backend-api/codex/models`,
      `${root}/v1/sub2api/billing`,
    ]);
    expect(provider.models).toHaveLength(1);
    expect(provider.models![0]).toMatchObject({
      id: "astra-preview",
      name: "Astra Preview",
      api: "openai-codex-responses",
      reasoning: true,
      input: ["text"],
      contextWindow: 262144,
      maxTokens: 64000,
      thinkingLevelMap: {
        off: "none",
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    });
    const manifestCall = calls.find(({ url }) => url.endsWith("/backend-api/codex/models"))!;
    expect(new Headers(manifestCall.init?.headers).get("authorization")).toBe("Bearer sk-manifest");
    expect(manifestCall.init?.redirect).toBe("error");
    expect(manifestCall.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([[], ["none"], undefined])(
    "does not infer reasoning from a model name when manifest efforts are %j",
    async (efforts) => {
      vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === `${root}/backend-api/codex/models`) {
          return Response.json({
            models: [
              {
                slug: "gpt-5.5",
                supported_reasoning_levels: efforts,
                input_modalities: ["text", "image", "audio", "image"],
              },
            ],
          });
        }
        return new Response(null, { status: 404 });
      });

      const provider = await registerProvider();
      expect(provider.models![0]).toMatchObject({
        id: "gpt-5.5",
        name: "gpt-5.5",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 272000,
        maxTokens: 128000,
        cost: { input: 5, output: 30 },
      });
      expect(provider.models![0]!.thinkingLevelMap).toBeUndefined();
    },
  );

  it("sanitizes manifest names and skips unsafe, duplicate, and image-only model IDs", async () => {
    vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${root}/backend-api/codex/models`) {
        return Response.json({
          models: [
            null,
            {},
            { slug: " bad-id" },
            { slug: "bad\nmodel" },
            { slug: "x".repeat(257) },
            { slug: "gpt-6-astra", display_name: "\u001b[31mAstra\n\u001b[0m" },
            { slug: "gpt-6-astra", display_name: "Duplicate" },
            { slug: "gpt-image-2" },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });

    const provider = await registerProvider();
    expect(provider.models).toHaveLength(1);
    expect(provider.models![0]).toMatchObject({
      id: "gpt-6-astra",
      name: "Astra",
      input: ["text"],
    });
  });

  it.each([
    { scenario: "unavailable", status: 404, body: "", error: true },
    { scenario: "invalid JSON", status: 200, body: "{", error: true },
    { scenario: "missing its models array", status: 200, body: '{"data":[]}', error: true },
    {
      scenario: "oversized",
      status: 200,
      body: JSON.stringify({ models: [], padding: "x".repeat(1024 * 1024) }),
      error: true,
    },
    { scenario: "empty", status: 200, body: '{"models":[]}', error: false },
  ])(
    "does not fall back to /v1/models when the manifest is $scenario",
    async ({ status, body, error }) => {
      const calls: string[] = [];
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);
        if (url === `${root}/backend-api/codex/models`) return new Response(body, { status });
        if (url === `${root}/v1/models`) {
          return Response.json({ data: [{ id: "gpt-6-astra" }] });
        }
        return new Response(null, { status: 404 });
      });

      const provider = await registerProvider();
      expect(provider.models).toEqual([]);
      expect(calls.sort()).toEqual([
        `${root}/backend-api/codex/models`,
        `${root}/v1/sub2api/billing`,
      ]);
      const manifestError = [
        "[sub2api:codex] failed to fetch Codex model manifest:",
        expect.any(Error),
      ];
      expect(consoleError.mock.calls).toEqual(error ? [manifestError] : []);
    },
  );
});
