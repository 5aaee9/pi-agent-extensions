// Routing and credentials from the outside: each relay API reaches its endpoint
// with its own token in every accepted form.
import assert from "node:assert/strict";

import type { JsonRecord } from "../../release/json.ts";
import { modelsOf } from "./pi.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { headerOf, inventoryOf, manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay, RelayRoutes } from "./servers-sub2api.ts";
import {
  CODEX,
  PACKAGE,
  inSequence,
  modelArgs,
  mustFindModel,
} from "./pi-provider-sub2api-support.ts";

interface RouteRow {
  readonly provider: string;
  readonly model: string;
  readonly api: string;
  readonly path: string;
  readonly codexAdapter: boolean;
}

const ROUTES: readonly RouteRow[] = [
  { provider: "codex", model: "gpt-5.5", api: CODEX, path: "/v1/responses", codexAdapter: true },
  {
    provider: "responses",
    model: "gpt-5.5",
    api: "openai-responses",
    path: "/v1/responses",
    codexAdapter: false,
  },
  {
    provider: "completions",
    model: "gpt-5.5",
    api: "openai-completions",
    path: "/v1/chat/completions",
    codexAdapter: false,
  },
  {
    provider: "claude",
    model: "claude-opus-4-6",
    api: "anthropic-messages",
    path: "/v1/messages",
    codexAdapter: false,
  },
  { provider: "auto", model: "gpt-5.5", api: CODEX, path: "/v1/responses", codexAdapter: true },
  {
    provider: "auto",
    model: "claude-opus-4-6",
    api: "anthropic-messages",
    path: "/v1/messages",
    codexAdapter: false,
  },
  {
    provider: "auto",
    model: "grok-e2e",
    api: "openai-responses",
    path: "/v1/responses",
    codexAdapter: false,
  },
];

const MANIFEST = manifestOf([{ slug: "gpt-5.5", supported_reasoning_levels: ["low", "high"] }]);
const INVENTORY = inventoryOf([{ id: "gpt-5.5" }]);

interface RelaySpec {
  readonly provider: string;
  readonly routes: Partial<RelayRoutes>;
  readonly api?: string;
}

const RELAY_SPECS: readonly RelaySpec[] = [
  { provider: "codex", routes: { manifest: MANIFEST }, api: CODEX },
  { provider: "responses", routes: { inventory: INVENTORY }, api: "openai-responses" },
  { provider: "completions", routes: { inventory: INVENTORY }, api: "openai-completions" },
  {
    provider: "claude",
    routes: { inventory: inventoryOf([{ id: "claude-opus-4-6" }]) },
    api: "anthropic-messages",
  },
  {
    provider: "auto",
    routes: {
      inventory: inventoryOf([{ id: "gpt-5.5" }, { id: "claude-opus-4-6" }, { id: "grok-e2e" }]),
      manifest: MANIFEST,
    },
  },
];

interface StartedRelay {
  readonly spec: RelaySpec;
  readonly relay: Relay;
  readonly entry: Readonly<Record<string, unknown>>;
}

async function routedRelays(context: Scenario): Promise<ReadonlyMap<string, Relay>> {
  const started = await Promise.all(
    RELAY_SPECS.map(async (spec): Promise<StartedRelay> => {
      const relay = await startRelay(context.server, spec.routes);
      const entry = {
        baseURL: relay.v1,
        token: `sk-${spec.provider}`,
        ...(spec.api === undefined ? {} : { api: spec.api }),
      };
      return { spec, relay, entry };
    }),
  );
  context.world.writeAgentFile(
    "sub2api.json",
    Object.fromEntries(started.map((item) => [item.spec.provider, item.entry])),
  );
  return new Map(started.map((item) => [item.spec.provider, item.relay]));
}

function credentialOf(request: RecordedRequest | undefined, row: RouteRow): string | undefined {
  return row.api === "anthropic-messages"
    ? headerOf(request, "x-api-key")
    : headerOf(request, "authorization");
}

const expectedCredential = (row: RouteRow): string =>
  row.api === "anthropic-messages" ? `sk-${row.provider}` : `Bearer sk-${row.provider}`;

function assertRoute(row: RouteRow, relay: Relay, listed: readonly JsonRecord[]): void {
  const label = `${row.provider}/${row.model}`;
  const request = relay.at(row.path).findLast((entry) => entry.method === "POST");
  assert.ok(request !== undefined, `${label} reached no ${row.path}`);
  assert.equal(credentialOf(request, row), expectedCredential(row), label);
  assert.equal(headerOf(request, "chatgpt-account-id"), undefined, label);
  assert.equal(headerOf(request, "content-encoding") === "zstd", row.codexAdapter, label);
  assert.equal(bodyOf(request)["model"], row.model, label);
  const model = mustFindModel(listed, row.provider, row.model);
  assert.equal(model["api"], row.api, label);
  const v1 = row.api !== "anthropic-messages";
  assert.equal(model["baseUrl"], v1 ? relay.v1 : relay.baseUrl, label);
}

async function promptEachRoute(
  client: RpcClient,
  relays: { readonly get: (provider: string) => Relay | undefined },
): Promise<void> {
  const listed = modelsOf(await client.send({ type: "get_available_models" }));
  await inSequence(ROUTES, async (row) => {
    const selected = await client.send({
      type: "set_model",
      provider: row.provider,
      modelId: row.model,
    });
    assert.equal(selected["success"], true, JSON.stringify(selected));
    await client.prompt(`hello ${row.provider} ${row.model}`);
    const relay = relays.get(row.provider);
    assert.ok(relay !== undefined);
    assertRoute(row, relay, listed);
  });
}

scenario(
  "each relay API reaches its own endpoint with its own credential and no ChatGPT identity",
  PACKAGE,
  async (context) => {
    const relays = await routedRelays(context);
    const { rpc, world } = context;
    const client = rpc(modelArgs(world, "codex", "gpt-5.5"));
    await promptEachRoute(client, relays);
    assert.deepEqual(client.extensionErrors(), []);
    const models = modelsOf(await client.send({ type: "get_available_models" }));
    const find = (provider: string, id: string): JsonRecord | undefined =>
      models.find((model) => model["provider"] === provider && model["id"] === id);
    assert.deepEqual(find("auto", "claude-opus-4-6")?.["compat"], { forceAdaptiveThinking: true });
    assert.deepEqual(find("auto", "claude-opus-4-6")?.["thinkingLevelMap"], { xhigh: "max" });
    assert.equal(find("auto", "grok-e2e")?.["reasoning"], false);
    assert.deepEqual(find("auto", "gpt-5.5")?.["thinkingLevelMap"], {
      off: "none",
      minimal: "low",
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    });
  },
);

const SPECIAL = "!literal$TOKEN${OTHER}$$tail";

interface TokenRow {
  readonly provider: string;
  readonly token: string;
  readonly expected: string;
  readonly api: string;
}

const TOKEN_ROWS: readonly TokenRow[] = [
  { provider: "env", token: "${E2E_RELAY_TOKEN}", expected: "env-token", api: CODEX },
  {
    provider: "command",
    token: "!printf cmd-token",
    expected: "cmd-token",
    api: "openai-responses",
  },
  { provider: "literal-codex", token: `$${SPECIAL}`, expected: SPECIAL, api: CODEX },
  {
    provider: "literal-responses",
    token: `$${SPECIAL}`,
    expected: SPECIAL,
    api: "openai-responses",
  },
  {
    provider: "literal-completions",
    token: `$${SPECIAL}`,
    expected: SPECIAL,
    api: "openai-completions",
  },
  {
    provider: "literal-claude",
    token: `$${SPECIAL}`,
    expected: SPECIAL,
    api: "anthropic-messages",
  },
];

interface TokenRelay {
  readonly row: TokenRow;
  readonly relay: Relay;
}

const modelFor = (row: TokenRow): string =>
  row.api === "anthropic-messages" ? "claude-opus-4-6" : "gpt-5.5";

scenario(
  "environment, command, and literal tokens reach discovery, billing, and the model request unchanged",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relays = await Promise.all(
      TOKEN_ROWS.map(async (row): Promise<TokenRelay> => {
        const relay = await startRelay(server, {
          manifest: MANIFEST,
          inventory: inventoryOf([{ id: modelFor(row) }]),
        });
        return { row, relay };
      }),
    );
    world.writeAgentFile(
      "sub2api.json",
      Object.fromEntries(
        relays.map((item) => [
          item.row.provider,
          { baseURL: item.relay.v1, token: item.row.token, api: item.row.api },
        ]),
      ),
    );
    const client = rpc(["--session-dir", world.sessionDir], {
      env: { E2E_RELAY_TOKEN: "env-token" },
    });
    await inSequence(relays, async (item) => {
      const { row, relay } = item;
      await client.send({ type: "set_model", provider: row.provider, modelId: modelFor(row) });
      await client.prompt(`hello ${row.provider}`);
      assert.ok(relay.at("/v1/sub2api/billing").length > 0, row.provider);
      const turns = relay.requests.filter((request) => request.method === "POST");
      assert.equal(turns.length, 1, `${row.provider} must reach its model endpoint`);
      for (const request of relay.requests) {
        const isMessages = request.url.startsWith("/v1/messages");
        const sent = headerOf(request, isMessages ? "x-api-key" : "authorization");
        const wanted = isMessages ? row.expected : `Bearer ${row.expected}`;
        assert.equal(sent, wanted, `${row.provider} ${request.url}`);
      }
    });
  },
);
