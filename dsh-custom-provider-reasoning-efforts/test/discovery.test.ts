import { describe, expect, it } from "vitest";

import {
  hasCodexManifest,
  isListableApi,
  listingUrl,
  manifestUrl,
  probeManifest,
  probeRoute,
  type RouteProbe,
} from "../discovery.ts";

interface Answer {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

/** A fetch stand-in that records each request and answers once. */
function fetchAnswering(answer: Answer): {
  readonly calls: Array<{ readonly url: string; readonly headers: Headers }>;
  readonly fetchImpl: typeof fetch;
} {
  const calls: Array<{ readonly url: string; readonly headers: Headers }> = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String((input as { url?: unknown }).url);
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response(answer.body, {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("listingUrl", () => {
  it("lists an OpenAI protocol at the base plus /models", () => {
    expect(listingUrl("https://magpie.indexyz.me/v1", "openai-responses")).toBe(
      "https://magpie.indexyz.me/v1/models",
    );
    expect(listingUrl("https://gateway.example/openai/v1/", "openai-completions")).toBe(
      "https://gateway.example/openai/v1/models",
    );
  });

  it("lists Anthropic Messages at the root /v1", () => {
    expect(listingUrl("https://api.anthropic.com", "anthropic-messages")).toBe(
      "https://api.anthropic.com/v1/models?limit=1000",
    );
    expect(listingUrl("https://api.anthropic.com/v1", "anthropic-messages")).toBe(
      "https://api.anthropic.com/v1/models?limit=1000",
    );
  });
});

describe("isListableApi", () => {
  it("accepts the protocols whose listing this build reads", () => {
    expect(isListableApi("openai-responses")).toBe(true);
    expect(isListableApi("openai-completions")).toBe(true);
    expect(isListableApi("anthropic-messages")).toBe(true);
    expect(isListableApi("google-generative-ai")).toBe(false);
  });
});

describe("probeRoute", () => {
  const base: RouteProbe = {
    route: "magpie",
    baseURL: "https://magpie.indexyz.me/v1",
    api: "openai-responses",
  };

  it("sends a bearer credential and the attribution header", async () => {
    const { calls, fetchImpl } = fetchAnswering({
      body: JSON.stringify({ data: [{ id: "a", reasoning: true, reasoning_levels: ["low"] }] }),
    });
    const models = await probeRoute({ ...base, apiKey: "secret", fetchImpl });
    expect(models).toEqual([{ id: "a", efforts: { low: "low" } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://magpie.indexyz.me/v1/models");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
    expect(calls[0]?.headers.get("user-agent")).toBeTruthy();
  });

  it("sends the route's own headers and no credential when none was found", async () => {
    const { calls, fetchImpl } = fetchAnswering({ body: JSON.stringify({ data: [] }) });
    await probeRoute({ ...base, headers: { "x-gateway": "on" }, fetchImpl });
    expect(calls[0]?.headers.get("x-gateway")).toBe("on");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("authenticates Anthropic Messages with x-api-key and the API version", async () => {
    const { calls, fetchImpl } = fetchAnswering({ body: JSON.stringify({ data: [] }) });
    await probeRoute({
      route: "anthropic",
      baseURL: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "sk-ant",
      fetchImpl,
    });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[0]?.headers.get("x-api-key")).toBe("sk-ant");
    expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("refuses a protocol whose listing it cannot read", async () => {
    await expect(
      probeRoute({
        route: "other",
        baseURL: "https://other.example/v1",
        api: "google-generative-ai",
      }),
    ).rejects.toThrow(/no model listing this build can read/);
  });

  it("reports an unreachable endpoint", async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error("dial tcp: connection refused");
    }) as unknown as typeof fetch;
    await expect(probeRoute({ ...base, fetchImpl })).rejects.toThrow(
      /could not reach https:\/\/magpie\.indexyz\.me\/v1\/models: dial tcp/,
    );
  });

  it("reports a refusal and hints at the credential", async () => {
    const { fetchImpl } = fetchAnswering({ body: "{}", status: 401 });
    await expect(probeRoute({ ...base, fetchImpl })).rejects.toThrow(
      /answered 401; check the API key/,
    );
  });

  it("reports a reply that is not JSON", async () => {
    const { fetchImpl } = fetchAnswering({ body: "<html>nope</html>" });
    await expect(probeRoute({ ...base, fetchImpl })).rejects.toThrow(/did not answer with JSON/);
  });

  it("refuses an oversized reply", async () => {
    const { fetchImpl } = fetchAnswering({ body: "x".repeat(4 * 1024 * 1024 + 1) });
    await expect(probeRoute({ ...base, fetchImpl })).rejects.toThrow(/more than 4194304 bytes/);
  });
});

describe("manifestUrl", () => {
  it("joins the route's root with the Codex manifest path", () => {
    expect(manifestUrl("https://aicoding.api.zeroclover.io/v1")).toBe(
      "https://aicoding.api.zeroclover.io/backend-api/codex/models",
    );
    expect(manifestUrl("https://relay.example/openai/v1/")).toBe(
      "https://relay.example/openai/backend-api/codex/models",
    );
    expect(manifestUrl("https://relay.example")).toBe(
      "https://relay.example/backend-api/codex/models",
    );
  });
});

describe("hasCodexManifest", () => {
  it("consults the manifest for the Responses protocol only", () => {
    expect(hasCodexManifest("openai-responses")).toBe(true);
    expect(hasCodexManifest("openai-completions")).toBe(false);
    expect(hasCodexManifest("anthropic-messages")).toBe(false);
  });
});

describe("probeManifest", () => {
  const base: RouteProbe = {
    route: "zero-aicoding-codex",
    baseURL: "https://aicoding.api.zeroclover.io/v1",
    api: "openai-responses",
  };

  it("reads the efforts each model accepts and ignores names pi-ai does not know", async () => {
    const { calls, fetchImpl } = fetchAnswering({
      body: JSON.stringify({
        models: [
          {
            slug: "gpt-6.1-sol",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
          },
          { slug: "gpt-6-luna", supported_reasoning_levels: ["medium"] },
        ],
      }),
    });
    const models = await probeManifest({ ...base, apiKey: "secret", fetchImpl });
    expect(models).toEqual([
      { id: "gpt-6.1-sol", efforts: { low: "low" } },
      { id: "gpt-6-luna", efforts: { medium: "medium" } },
    ]);
    expect(calls[0]?.url).toBe("https://aicoding.api.zeroclover.io/backend-api/codex/models");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret");
  });

  it("treats a relay without the endpoint as having no manifest", async () => {
    for (const status of [403, 404]) {
      const { fetchImpl } = fetchAnswering({ body: "<html>no</html>", status });
      await expect(probeManifest({ ...base, fetchImpl })).resolves.toBeUndefined();
    }
    const html = fetchAnswering({ body: "<html>not json</html>" });
    await expect(probeManifest({ ...base, fetchImpl: html.fetchImpl })).resolves.toBeUndefined();
    const other = fetchAnswering({ body: JSON.stringify({ object: "list" }) });
    await expect(probeManifest({ ...base, fetchImpl: other.fetchImpl })).resolves.toBeUndefined();
  });

  it("reports a status the endpoint owned", async () => {
    const { fetchImpl } = fetchAnswering({ body: "{}", status: 500 });
    await expect(probeManifest({ ...base, fetchImpl })).rejects.toThrow(
      /backend-api\/codex\/models answered 500/,
    );
  });

  it("reports an unreachable endpoint", async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error("dial tcp: connection refused");
    }) as unknown as typeof fetch;
    await expect(probeManifest({ ...base, fetchImpl })).rejects.toThrow(/could not reach/);
  });

  it("refuses an oversized manifest", async () => {
    const { fetchImpl } = fetchAnswering({ body: "x".repeat(4 * 1024 * 1024 + 1) });
    await expect(probeManifest({ ...base, fetchImpl })).rejects.toThrow(/more than 4194304 bytes/);
  });
});
