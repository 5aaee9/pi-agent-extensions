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

import { startServer } from "./fixture.ts";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

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

describe("probeRoute over real HTTP", () => {
  it("sends a bearer credential and the attribution header", async () => {
    const server = await startServer({
      "/v1/models": {
        body: { data: [{ id: "a", reasoning: true, reasoning_levels: ["low"] }] },
      },
    });
    const probe: RouteProbe = {
      route: "magpie",
      baseURL: `${server.url}/v1`,
      api: "openai-responses",
      apiKey: "secret",
    };
    const models = await probeRoute(probe);

    expect(models).toEqual([{ id: "a", efforts: { low: "low" } }]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe("/v1/models");
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer secret");
    expect(server.requests[0]?.headers["accept"]).toBe("application/json");
    expect(server.requests[0]?.headers["user-agent"]).toBeTruthy();
  });

  it("sends the route's own headers and no credential when none was found", async () => {
    const server = await startServer({ "/v1/models": { body: { data: [] } } });
    await probeRoute({
      route: "magpie",
      baseURL: `${server.url}/v1`,
      api: "openai-responses",
      headers: { "x-gateway": "on" },
    });

    expect(server.requests[0]?.headers["x-gateway"]).toBe("on");
    expect(server.requests[0]?.headers["authorization"]).toBeUndefined();
  });

  it("authenticates Anthropic Messages with x-api-key and the API version", async () => {
    const server = await startServer({ "/v1/models?limit=1000": { body: { data: [] } } });
    await probeRoute({
      route: "anthropic",
      baseURL: server.url,
      api: "anthropic-messages",
      apiKey: "sk-ant",
    });

    expect(server.requests[0]?.url).toBe("/v1/models?limit=1000");
    expect(server.requests[0]?.headers["x-api-key"]).toBe("sk-ant");
    expect(server.requests[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(server.requests[0]?.headers["authorization"]).toBeUndefined();
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
    const server = await startServer({});
    await server.close();
    await expect(
      probeRoute({ route: "magpie", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(/could not reach .*\/v1\/models/);
  });

  it("reports a refusal and hints at the credential", async () => {
    const server = await startServer({
      "/v1/models": { status: 401, body: {} },
    });
    await expect(
      probeRoute({ route: "magpie", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(/answered 401; check the API key/);
  });

  it("reports a reply that is not JSON", async () => {
    const server = await startServer({
      "/v1/models": { body: "<html>nope</html>" },
    });
    await expect(
      probeRoute({ route: "magpie", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(/did not answer with JSON/);
  });

  it("refuses an oversized reply", async () => {
    const server = await startServer({
      "/v1/models": { body: "x".repeat(MAX_RESPONSE_BYTES + 1) },
    });
    await expect(
      probeRoute({ route: "magpie", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(new RegExp(`more than ${String(MAX_RESPONSE_BYTES)} bytes`));
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

describe("probeManifest over real HTTP", () => {
  const manifestBody = {
    models: [
      {
        slug: "gpt-6.1-sol",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
      },
      { slug: "gpt-6-luna", supported_reasoning_levels: ["medium"] },
    ],
  };

  it("reads the efforts each model accepts and ignores names pi-ai does not know", async () => {
    const server = await startServer({
      "/backend-api/codex/models": { body: manifestBody },
    });
    const models = await probeManifest({
      route: "zero-aicoding-codex",
      baseURL: `${server.url}/v1`,
      api: "openai-responses",
      apiKey: "secret",
    });

    expect(models).toEqual([
      { id: "gpt-6.1-sol", efforts: { low: "low" } },
      { id: "gpt-6-luna", efforts: { medium: "medium" } },
    ]);
    expect(server.requests[0]?.url).toBe("/backend-api/codex/models");
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer secret");
  });

  it("treats a relay without the endpoint as having no manifest", async () => {
    const forbidden = await startServer({
      "/backend-api/codex/models": { status: 403, body: "<html>no</html>" },
    });
    await expect(
      probeManifest({
        route: "relay",
        baseURL: `${forbidden.url}/v1`,
        api: "openai-responses",
      }),
    ).resolves.toBeUndefined();

    const missing = await startServer({
      "/backend-api/codex/models": { status: 404, body: "<html>no</html>" },
    });
    await expect(
      probeManifest({ route: "relay", baseURL: `${missing.url}/v1`, api: "openai-responses" }),
    ).resolves.toBeUndefined();

    const html = await startServer({
      "/backend-api/codex/models": { body: "<html>not json</html>" },
    });
    await expect(
      probeManifest({ route: "relay", baseURL: `${html.url}/v1`, api: "openai-responses" }),
    ).resolves.toBeUndefined();

    const notManifest = await startServer({
      "/backend-api/codex/models": { body: { object: "list" } },
    });
    await expect(
      probeManifest({ route: "relay", baseURL: `${notManifest.url}/v1`, api: "openai-responses" }),
    ).resolves.toBeUndefined();
  });

  it("reports a status the endpoint owned", async () => {
    const server = await startServer({
      "/backend-api/codex/models": { status: 500, body: {} },
    });
    await expect(
      probeManifest({ route: "relay", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(/backend-api\/codex\/models answered 500/);
  });

  it("reports an unreachable endpoint", async () => {
    const server = await startServer({});
    await server.close();
    await expect(
      probeManifest({ route: "relay", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(/could not reach/);
  });

  it("refuses an oversized manifest", async () => {
    const server = await startServer({
      "/backend-api/codex/models": { body: "x".repeat(MAX_RESPONSE_BYTES + 1) },
    });
    await expect(
      probeManifest({ route: "relay", baseURL: `${server.url}/v1`, api: "openai-responses" }),
    ).rejects.toThrow(new RegExp(`more than ${String(MAX_RESPONSE_BYTES)} bytes`));
  });
});
