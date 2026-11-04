// Which requests offline mode still sends: none of the extension's own, except the
// refresh a user asks for.
import assert from "node:assert/strict";

import { extensionCommands, modelKeys } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { billingReply } from "./servers-sub2api-replies.ts";
import {
  CODEX,
  DISCOVERY_TTL_MS,
  PACKAGE,
  modelArgs,
  runCommand,
  seedDiscovery,
} from "./pi-provider-sub2api-support.ts";

const GPT = { id: "gpt-5.5", name: "GPT 5.5" };
const MANIFEST = manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low", "high"] }]);

async function offlineRelay(context: Scenario): Promise<Relay> {
  const relay = await startRelay(context.server, {
    manifest: MANIFEST,
    billing: () => billingReply(0.5),
    usage: () => json({ mode: "quota" }),
  });
  context.world.writeAgentFile("sub2api.json", {
    relay: { baseURL: relay.v1, token: "tok", api: CODEX },
  });
  return relay;
}

interface OfflineForm {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

const OFFLINE_FORMS: readonly OfflineForm[] = [
  { args: ["--offline"], env: {} },
  { args: [], env: { PI_OFFLINE: "1" } },
];

scenario(
  "offline cold start sends the relay nothing, under --offline and PI_OFFLINE=1",
  PACKAGE,
  async (context) => {
    const relay = await offlineRelay(context);
    const { rpc, world } = context;
    const seen = await Promise.all(
      OFFLINE_FORMS.map(async ({ args, env }) => {
        const client = rpc(["--session-dir", world.sessionDir, ...args], { env });
        const models = await client.send({ type: "get_available_models" });
        const commands = extensionCommands(await client.send({ type: "get_commands" }));
        assert.ok(commands.includes("sub2api-refresh"), "the extension must still load offline");
        assert.deepEqual(client.extensionErrors(), []);
        await client.close();
        return modelKeys(models).includes("relay/gpt-5.5");
      }),
    );
    assert.deepEqual(seen, [false, false]);
    assert.deepEqual(
      relay.requests.map((request) => request.url),
      [],
    );
  },
);

scenario(
  "an offline prompt from a stale seeded cache sends only its model request, and the models stay available",
  PACKAGE,
  async (context) => {
    const relay = await offlineRelay(context);
    const { rpc, world } = context;
    seedDiscovery(world, {
      relay: { baseUrl: relay.v1, api: CODEX, ageMs: 2 * DISCOVERY_TTL_MS, models: [GPT] },
    });
    const client = rpc(["--offline", ...modelArgs(world, "relay", "gpt-5.5")]);
    const listed = await client.send({ type: "get_available_models" });
    assert.ok(modelKeys(listed).includes("relay/gpt-5.5"));
    await client.send({ type: "set_model", provider: "relay", modelId: "gpt-5.5" });
    await client.prompt("offline turn");
    await client.close();
    assert.deepEqual(
      relay.requests.map((request) => `${request.method} ${request.url}`),
      ["POST /v1/responses"],
    );
    const viaEnv = rpc(modelArgs(world, "relay", "gpt-5.5"), { env: { PI_OFFLINE: "1" } });
    await viaEnv.prompt("offline turn by environment");
    await viaEnv.close();
    assert.deepEqual(
      relay.requests.map((request) => `${request.method} ${request.url}`),
      ["POST /v1/responses", "POST /v1/responses"],
    );
  },
);

scenario(
  "/sub2api-refresh still reaches the relay offline, because the user asked for it",
  PACKAGE,
  async (context) => {
    const relay = await offlineRelay(context);
    const { rpc, world } = context;
    const client = rpc(["--offline", "--session-dir", world.sessionDir]);
    await runCommand(client, "/sub2api-refresh", "Refreshed discovered models");
    const listed = await client.send({ type: "get_available_models" });
    assert.ok(modelKeys(listed).includes("relay/gpt-5.5"));
    assert.equal(relay.at("/backend-api/codex/models").length, 1);
  },
);
