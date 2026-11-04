import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRelayConfigs } from "../config.ts";
import { renderUsageFooter } from "../footer.ts";

let stateDir: string;
let configPath: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sub2api-test-"));
  configPath = join(stateDir, "sub2api.json");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

async function loadError(entry: Record<string, unknown>) {
  writeFileSync(configPath, JSON.stringify({ invalid: entry }));
  const error = await loadRelayConfigs(configPath).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
}

describe("usage footer", () => {
  it.each<{
    name: string;
    messages: { role?: string; input?: number; cacheRead?: number; cacheWrite?: number }[];
    expected: string | undefined;
  }>([
    {
      name: "latest response rather than cumulative usage",
      messages: [{ input: 90_000 }, { input: 1_000, cacheRead: 9_000 }],
      expected: "CH90.0%",
    },
    {
      name: "cache writes in the prompt denominator",
      messages: [{ input: 1_000, cacheRead: 8_000, cacheWrite: 1_000 }],
      expected: "CH80.0%",
    },
    {
      name: "zero hits after an earlier cache hit",
      messages: [{ cacheRead: 9_000 }, { input: 1_000 }],
      expected: "CH0.0%",
    },
    {
      name: "cache writes without cache reads",
      messages: [{ input: 1_000, cacheWrite: 9_000 }],
      expected: "CH0.0%",
    },
    {
      name: "tool usage does not replace the latest assistant rate",
      messages: [
        { input: 1_000, cacheRead: 9_000 },
        { role: "toolResult", input: 9_000, cacheRead: 1_000 },
      ],
      expected: "CH90.0%",
    },
    { name: "no cached usage", messages: [{ input: 1_000 }], expected: undefined },
    { name: "empty session", messages: [], expected: undefined },
    {
      name: "latest response has no prompt tokens",
      messages: [{ cacheRead: 9_000 }, {}],
      expected: undefined,
    },
  ])("renders cache hit rate for $name", ({ messages, expected }) => {
    const entries = messages.map(
      ({ role = "assistant", input = 0, cacheRead = 0, cacheWrite = 0 }) => ({
        type: "message",
        message: { role, usage: { input, cacheRead, cacheWrite } },
      }),
    );
    const context = {
      cwd: join(homedir(), "Projects", "demo"),
      model: { provider: "relay", id: "gpt-test" },
      thinkingLevel: "off",
      getContextUsage: () => ({ tokens: 0, contextWindow: 64_000, percent: 0 }),
      sessionManager: { getEntries: () => entries, getSessionName: () => undefined },
    } as unknown as ExtensionContext;
    const footer = renderUsageFooter(
      context,
      {
        getGitBranch: () => null,
        getAvailableProviderCount: () => 1,
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => {},
      },
      { fg: (_color: string, text: string) => text } as ExtensionContext["ui"]["theme"],
      undefined,
      false,
      false,
      200,
    );
    expect(footer[1]!.match(/CH[\d.]+%/)?.[0]).toBe(expected);
  });
});

describe("relay configuration", () => {
  it.each([
    {
      label: "non-object container",
      entry: { serverTools: true },
      message: "serverTools must be an object",
    },
    {
      label: "unknown protocol group",
      entry: { serverTools: { chat: [] } },
      message: "unsupported serverTools group",
    },
    {
      label: "non-array protocol list",
      entry: { serverTools: { responses: { type: "web_search" } } },
      message: "serverTools.responses must be an array",
    },
    {
      label: "missing tool type",
      entry: { serverTools: { responses: [{}] } },
      message: "must have a valid non-empty type",
    },
    {
      label: "client-executed Responses function",
      entry: { serverTools: { responses: [{ type: "function", name: "local" }] } },
      message: "requires client-side handling",
    },
    {
      label: "unrepresentable Responses image output",
      entry: { serverTools: { responses: [{ type: "image_generation" }] } },
      message: "output Pi cannot retain",
    },
    {
      label: "file search without vector stores",
      entry: { serverTools: { responses: [{ type: "file_search", vector_store_ids: [] }] } },
      message: "requires non-empty vector_store_ids",
    },
    {
      label: "code interpreter without a hosted container",
      entry: { serverTools: { responses: [{ type: "code_interpreter" }] } },
      message: "requires a container ID",
    },
    {
      label: "shell with a local environment",
      entry: {
        serverTools: { responses: [{ type: "shell", environment: { type: "local" } }] },
      },
      message: "requires a hosted container environment",
    },
    {
      label: "client-executed tool search",
      entry: {
        serverTools: { responses: [{ type: "tool_search", execution: "client" }] },
      },
      message: 'requires execution "server"',
    },
    {
      label: "interactive MCP approval",
      entry: {
        serverTools: {
          responses: [
            {
              type: "mcp",
              server_label: "docs",
              server_url: "https://mcp.example/sse",
              authorization: "mcp-secret",
              require_approval: "always",
            },
          ],
        },
      },
      message: 'requires require_approval "never"',
    },
    {
      label: "client-executed Anthropic bash",
      entry: {
        api: "anthropic-messages",
        serverTools: { anthropic: [{ type: "bash_20250124", name: "bash" }] },
      },
      message: "requires client-side handling",
    },
    {
      label: "invalid Anthropic built-in name",
      entry: {
        api: "anthropic-messages",
        serverTools: {
          anthropic: [{ type: "web_search_20250305", name: "wrong_name" }],
        },
      },
      message: "requires name web_search",
    },
    {
      label: "protocol mismatch",
      entry: {
        api: "anthropic-messages",
        serverTools: { responses: [{ type: "web_search" }] },
      },
      message: "cannot use serverTools.responses",
    },
    {
      label: "Completions protocol",
      entry: {
        api: "openai-completions",
        serverTools: { responses: [{ type: "web_search" }] },
      },
      message: "cannot use serverTools with api openai-completions",
    },
  ])("rejects $label server tool configuration", async ({ entry, message }) => {
    const error = await loadError({
      baseURL: "https://invalid-tools.example",
      token: "config-secret",
      ...entry,
    });
    expect(error).toContain(message);
    expect(error).not.toContain("config-secret");
    expect(error).not.toContain("mcp-secret");
  });

  it("rejects the wire value as a compress_service_tier", async () => {
    const error = await loadError({
      baseURL: "https://invalid.example",
      token: "config-secret",
      compress_service_tier: "priority",
    });
    expect(error).toContain("compress_service_tier must be fast, ultrafast, or null");
  });

  it("rejects an invalid compress_model", async () => {
    const error = await loadError({
      baseURL: "https://invalid.example",
      token: "config-secret",
      compress_model: " gpt-5-mini",
    });
    expect(error).toContain("compress_model must be a valid model ID or null");
  });

  it.each([
    { label: "not set", name: "SUB2API_ENV_UNSET_TOKEN_TEST", value: undefined },
    { label: "set to whitespace", name: "SUB2API_ENV_WS_TOKEN_TEST", value: "   " },
  ])("rejects a token referencing an env variable that is $label", async ({ name, value }) => {
    if (value !== undefined) vi.stubEnv(name, value);
    const error = await loadError({
      baseURL: "https://invalid-env.example/v1",
      token: `\${${name}}`,
    });
    expect(error).toContain(
      `token references environment variable ${JSON.stringify(name)} which is not set`,
    );
  });

  it.each([
    {
      label: "base URL",
      entry: { baseURL: "https://example.com\n", token: "sk" },
      message: "baseURL must not include control characters",
    },
    {
      label: "token",
      entry: { baseURL: "https://example.com", token: "sk\nsecret" },
      message: "token must not include control characters",
    },
  ])("rejects control characters in the $label", async ({ entry, message }) => {
    const error = await loadError(entry);
    expect(error).toContain(message);
    expect(error).not.toContain("\n");
  });

  it.each(["#"])("rejects a base URL with a trailing %s", async (suffix) => {
    const error = await loadError({ baseURL: `https://invalid.example${suffix}`, token: "sk" });
    expect(error).toContain("must not include a query or fragment");
  });
});
