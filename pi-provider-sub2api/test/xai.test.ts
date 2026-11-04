import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRelayConfigs } from "../config.ts";

let stateDir: string;
let configPath: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-xai-"));
  configPath = join(stateDir, "sub2api.json");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

const writeConfig = (value: unknown) => writeFileSync(configPath, JSON.stringify(value));

describe("xAI entry configuration", () => {
  it("accepts the xAI contract and keeps other entry types unchanged", async () => {
    vi.stubEnv("SUB2API_GROK_TOKEN", "grok-env-token");
    writeConfig({
      grok: {
        baseURL: "https://relay.example/",
        token: "${SUB2API_GROK_TOKEN}",
        api: "xai",
        compress_model: null,
        compress_service_tier: null,
        serverTools: { responses: [], anthropic: [] },
        requestModes: { serviceTier: "fast" },
        modelRequestModes: { "grok-4.7": { daybreak: "blue" } },
      },
      "grok-command": {
        baseURL: "https://relay.example/v1",
        token: "!printf grok-command-token",
        api: "xai",
        serverTools: {},
      },
      responses: {
        baseURL: "https://relay.example",
        token: "sk-responses",
        api: "openai-responses",
        compress_model: "gpt-5-mini",
        serverTools: { responses: [{ type: "web_search" }] },
      },
    });

    const [grok, command, responses] = await loadRelayConfigs(configPath);
    expect(grok).toMatchObject({
      provider: "grok",
      api: "openai-responses",
      xai: true,
      apiKey: "grok-env-token",
      baseUrl: "https://relay.example/v1",
      compressModel: null,
      compressServiceTier: null,
      serverTools: undefined,
      requestModes: { serviceTier: "fast" },
    });
    expect(grok!.modelRequestModes.get("grok-4.7")).toEqual({ daybreak: "blue" });
    expect(command).toMatchObject({
      api: "openai-responses",
      xai: true,
      apiKey: "grok-command-token",
      baseUrl: "https://relay.example/v1",
    });
    expect(responses).toMatchObject({
      api: "openai-responses",
      xai: false,
      compressModel: "gpt-5-mini",
      serverTools: { responses: [{ type: "web_search" }] },
    });
  });

  it.each([
    [{ compress_model: "grok-4.7" }, /^provider grok compress_model is not supported with api xai/],
    [
      { compress_service_tier: "fast" },
      /^provider grok compress_service_tier is not supported with api xai/,
    ],
    [
      { serverTools: { responses: [{ type: "web_search" }] } },
      /^provider grok serverTools are not supported with api xai; hosted tools/,
    ],
    [
      { serverTools: { anthropic: [{ type: "web_search_20260209", name: "web_search" }] } },
      /^provider grok serverTools are not supported with api xai/,
    ],
    [{ serverTools: [] }, /^provider grok serverTools must be an object/],
    [{ token: "" }, /^provider grok is missing token/],
    [{ baseURL: "ftp://relay.example" }, /^provider grok baseURL must use http or https$/],
    [
      { baseURL: "https://user:sk-secret-value@relay.example" },
      /^provider grok baseURL must not include credentials$/,
    ],
    [
      { baseURL: "https://relay.example/v1?key=sk-secret-value" },
      /^provider grok baseURL must not include a query or fragment$/,
    ],
    [{ token: "${SUB2API_MISSING_GROK}" }, /^provider grok token references environment variable/],
    [{ token: "!exit 3" }, /^provider grok token: Credential command failed/],
    [{ requestModes: { serviceTier: "turbo" } }, /^provider grok requestModes.serviceTier/],
  ])("rejects %j with a field-specific, secret-free error", async (extra, message) => {
    writeConfig({
      grok: { baseURL: "https://relay.example", token: "sk-secret-value", api: "xai", ...extra },
    });
    const error = await loadRelayConfigs(configPath).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain("secret-value");
  });

  it("lists xai among the supported api selectors", async () => {
    writeConfig({ grok: { baseURL: "https://relay.example", token: "sk", api: "grok" } });
    await expect(loadRelayConfigs(configPath)).rejects.toThrow(
      /^provider grok has unsupported api "grok"; expected one of .*\bxai\b/,
    );
  });
});
