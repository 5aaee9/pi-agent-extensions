// `pi-custom-provider` discovery through the real bin: the offline contract, and
// an explicit refresh publishing what upstream now lists.
import assert from "node:assert/strict";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import { modelKeys } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { chatReply, isChatRequest, json } from "./servers.ts";
import type { LocalServer } from "./servers.ts";
import { readJsonRecord } from "./world.ts";

const PACKAGE = "pi-custom-provider";
const ONLINE = { packages: [PACKAGE], offline: false };
const REFRESH_NOTICE = "Custom provider models refreshed";

/** A provider whose discovery and models.dev catalog all point at this server. */
async function enrichedGateway(
  { server, world }: Pick<Scenario, "server" | "world">,
  modelId: () => string = () => "discovered",
): Promise<LocalServer> {
  const gateway = await server((request) => {
    if (isChatRequest(request)) return chatReply({});
    if (request.url === "/v1/models") return json({ data: [{ id: modelId() }] });
    return json({ acme: { models: { discovered: { limit: { context: 1000, output: 100 } } } } });
  });
  world.writeAgentFile("custom-provider.json", {
    modelsDev: {
      apiURL: `${gateway.baseUrl}/models-dev/api.json`,
      modelsURL: `${gateway.baseUrl}/models-dev/models.json`,
    },
    providers: {
      gateway: {
        baseURL: `${gateway.baseUrl}/v1`,
        apiKey: "key",
        fallbackModels: [{ id: "fallback" }],
      },
    },
  });
  return gateway;
}

for (const [label, offline, flags] of [
  ["PI_OFFLINE=1", true, []],
  ["--offline", false, ["--offline"]],
] as const)
  scenario(
    `a cold start under ${label} sends nothing and registers the fallback models`,
    { packages: [PACKAGE], offline },
    async (context) => {
      const gateway = await enrichedGateway(context);
      const client = context.rpc(["--no-session", ...flags]);
      const models = modelKeys(await client.send({ type: "get_available_models" }));
      assert.ok(models.includes("gateway/fallback"), JSON.stringify(models));
      assert.deepEqual(gateway.requests, [], "no discovery and no models.dev request");
      assert.deepEqual(client.extensionErrors(), []);
    },
  );

scenario(
  "/refresh-custom-provider-models still reaches upstream under offline, because the user asked",
  { packages: [PACKAGE], offline: true },
  async (context) => {
    const gateway = await enrichedGateway(context);
    const client = context.rpc(["--no-session"]);
    assert.deepEqual(gateway.requests, []);
    const refreshed = client.next(
      (event) => event["method"] === "notify" && event["message"] === REFRESH_NOTICE,
      "the refresh notification",
    );
    await client.send({ type: "prompt", message: "/refresh-custom-provider-models" });
    await refreshed;
    assert.ok(gateway.requests.length > 0, "the explicit refresh must reach upstream");
  },
);

function expireCaches(context: Pick<Scenario, "world">): void {
  const path = join(context.world.agentDir, "custom-provider-models.json");
  const cache = readJsonRecord(path);
  const { providers, modelsDev } = cache;
  assert.ok(isRecord(providers) && isRecord(modelsDev), JSON.stringify(cache));
  const { gateway } = providers;
  assert.ok(isRecord(gateway), JSON.stringify(cache));
  context.world.writeAgentFile("custom-provider-models.json", {
    ...cache,
    providers: { gateway: { ...gateway, fetchedAt: 0 } },
    modelsDev: { ...modelsDev, fetchedAt: 0 },
  });
}

scenario(
  "offline, expired caches stay registered and nothing refreshes them",
  ONLINE,
  async (context) => {
    const gateway = await enrichedGateway(context);
    const seeding = context.rpc(["--no-session"]);
    await seeding.send({ type: "get_available_models" });
    assert.equal(await seeding.close(), 0);
    const seeded = gateway.requests.length;
    assert.ok(seeded > 0, "the online start must have fetched");
    expireCaches(context);
    const client = context.rpc(
      ["--no-session", "--provider", "gateway", "--model", "discovered", "--approve"],
      { env: { PI_OFFLINE: "1" } },
    );
    await client.prompt("hello");
    assert.deepEqual(
      gateway.requests.slice(seeded).map((request) => request.url),
      ["/v1/chat/completions"],
      "the turn a user asked for is the only request",
    );
    assert.deepEqual(client.extensionErrors(), []);
  },
);

scenario(
  "/refresh-custom-provider-models publishes the models upstream now lists",
  ONLINE,
  async (context) => {
    let modelId = "before";
    await enrichedGateway(context, () => modelId);
    const client = context.rpc(["--no-session"]);
    const listed = async (): Promise<readonly string[]> =>
      modelKeys(await client.send({ type: "get_available_models" }));
    assert.ok((await listed()).includes("gateway/before"));
    modelId = "after";
    const refreshed = client.next(
      (event) => event["method"] === "notify" && event["message"] === REFRESH_NOTICE,
      "the refresh notification",
    );
    await client.send({ type: "prompt", message: "/refresh-custom-provider-models" });
    await refreshed;
    const models = await listed();
    assert.ok(models.includes("gateway/after"), JSON.stringify(models));
    assert.ok(!models.includes("gateway/before"), JSON.stringify(models));
    const selected = await client.send({
      type: "set_model",
      provider: "gateway",
      modelId: "after",
    });
    assert.equal(selected["success"], true, JSON.stringify(selected));
  },
);
