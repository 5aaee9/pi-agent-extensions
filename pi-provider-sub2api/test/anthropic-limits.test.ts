import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-anthropic-limits-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", stateDir);
  writeFileSync(
    join(stateDir, "sub2api.json"),
    JSON.stringify({
      claude: {
        baseURL: "https://claude-limits.example",
        token: "sk-test",
        api: "anthropic-messages",
      },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

async function discover(models: Record<string, unknown>[]) {
  const fetch = vi.fn<(input: URL | RequestInfo) => Promise<Response>>(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://claude-limits.example/v1/models") return Response.json({ data: models });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  const registrations: ProviderConfig[] = [];
  await extension({
    registerProvider(_name: string, config: ProviderConfig) {
      registrations.push(config);
    },
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI);
  expect(registrations).toHaveLength(1);
  // Claude capacity must not be inferred from a generated Codex manifest.
  expect(fetch.mock.calls.map(([input]) => String(input)).sort()).toEqual([
    "https://claude-limits.example/v1/models",
    "https://claude-limits.example/v1/sub2api/billing",
  ]);
  return registrations[0]!.models!;
}

describe("Anthropic context and output limits", () => {
  it("uses catalog context windows without adopting catalog output caps", async () => {
    const models = await discover([
      { id: "claude-opus-4-6" },
      { id: "claude-sonnet-4-6" },
      { id: "claude-haiku-4-5-20251001" },
      { id: "claude-unknown-context-test" },
    ]);
    expect(models.map(({ contextWindow, maxTokens }) => [contextWindow, maxTokens])).toEqual([
      [1_000_000, 16_384],
      [1_000_000, 16_384],
      [200_000, 8192],
      [200_000, 16_384],
    ]);
  });

  it("prefers remote context and output limits, including Anthropic max_input_tokens", async () => {
    const models = await discover([
      { id: "claude-opus-4-6", max_input_tokens: 300_000, max_tokens: 32_000 },
      { id: "claude-sonnet-4-6", context_window: 400_000, max_input_tokens: 900_000 },
      { id: "claude-remote-string", max_input_tokens: "500000" },
      { id: "claude-small-context", max_input_tokens: 4096, max_tokens: 8192 },
    ]);
    expect(models.map(({ contextWindow, maxTokens }) => [contextWindow, maxTokens])).toEqual([
      [300_000, 32_000],
      [400_000, 16_384],
      [500_000, 16_384],
      [4096, 4096],
    ]);
  });

  it.each([null, 0, -1, 0.5, 99_999_999, "invalid", true])(
    "ignores invalid max_input_tokens %j and retains catalog fallback",
    async (max_input_tokens) => {
      const models = await discover([{ id: "claude-opus-4-6", max_input_tokens }]);
      expect(models[0]).toMatchObject({ contextWindow: 1_000_000, maxTokens: 16_384 });
    },
  );

  it("prefers cached catalog context but still ignores its output cap", async () => {
    writeFileSync(
      join(stateDir, "models-store.json"),
      JSON.stringify({
        anthropic: {
          checkedAt: Date.now(),
          lastModified: Date.now(),
          models: [
            {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              provider: "anthropic",
              api: "anthropic-messages",
              baseUrl: "https://api.anthropic.com",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 600_000,
              maxTokens: 128_000,
              cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
            },
          ],
        },
      }),
    );
    const models = await discover([{ id: "claude-opus-4-6" }]);
    expect(models[0]).toMatchObject({ contextWindow: 600_000, maxTokens: 16_384 });
  });
});
