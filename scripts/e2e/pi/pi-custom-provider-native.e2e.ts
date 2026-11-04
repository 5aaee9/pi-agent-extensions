// `pi-custom-provider` from a user's configuration to the wire: each native API and
// key form round trips through Pi's own clients against a local server.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { modelKeys } from "./pi.ts";
import type { RpcClient } from "./pi.ts";
import { scenario } from "./scenario.ts";
import { bodyOf, chatReply, json } from "./servers.ts";
import type { RecordedRequest, Reply } from "./servers.ts";
import { anthropicReply, responsesReply } from "./servers-custom-provider.ts";

const ONLINE = { packages: ["pi-custom-provider"], offline: false };

interface NativeApi {
  readonly api: string;
  readonly chatPath: string;
  readonly reply: (text: string) => Reply;
  /** A setting whose effect is visible in the request body. */
  readonly compat: Readonly<Record<string, unknown>>;
  readonly compatReached: (body: JsonRecord) => boolean;
  /** Whether the body explicitly turns thinking off, which the `{off:null}` default forbids. */
  readonly thinkingDisabled: (body: JsonRecord) => boolean;
}

const firstInputRole = (body: JsonRecord): unknown => {
  const first: unknown = Array.isArray(body["input"]) ? body["input"][0] : undefined;
  return isRecord(first) ? first["role"] : undefined;
};

const eagerToolStreaming = (body: JsonRecord): boolean =>
  Array.isArray(body["tools"]) &&
  body["tools"].some((tool: unknown) => isRecord(tool) && "eager_input_streaming" in tool);

const COMPLETIONS: NativeApi = {
  api: "openai-completions",
  chatPath: "/v1/chat/completions",
  reply: (text) => chatReply({ text }),
  compat: { maxTokensField: "max_tokens" },
  compatReached: (body) => "max_tokens" in body && !("max_completion_tokens" in body),
  thinkingDisabled: (body) => body["reasoning_effort"] === "none",
};

const NATIVE_APIS: readonly NativeApi[] = [
  COMPLETIONS,
  {
    api: "openai-responses",
    chatPath: "/v1/responses",
    reply: responsesReply,
    compat: { supportsDeveloperRole: false },
    compatReached: (body) => firstInputRole(body) === "system",
    thinkingDisabled: (body) =>
      isRecord(body["reasoning"]) && body["reasoning"]["effort"] === "none",
  },
  {
    api: "anthropic-messages",
    chatPath: "/v1/messages",
    reply: anthropicReply,
    compat: { supportsEagerToolInputStreaming: false },
    compatReached: (body) => !eagerToolStreaming(body),
    thinkingDisabled: (body) =>
      isRecord(body["thinking"]) && body["thinking"]["type"] === "disabled",
  },
];

interface KeyForm {
  readonly name: string;
  readonly apiKey: string;
  /** The key each request must carry once Pi resolves `apiKey`. */
  readonly key: string;
  readonly authorizationHeader: boolean;
}

const LITERAL_KEY: KeyForm = {
  name: "literal",
  apiKey: "li$$teral",
  key: "li$teral",
  authorizationHeader: false,
};

const KEY_FORMS: readonly KeyForm[] = [
  { name: "command", apiKey: "!printf %s cmd-key", key: "cmd-key", authorizationHeader: false },
  LITERAL_KEY,
  { name: "header", apiKey: "plain-key", key: "plain-key", authorizationHeader: true },
  { name: "both", apiKey: "!printf %s cmd-key", key: "cmd-key", authorizationHeader: true },
];

interface Combination {
  readonly provider: string;
  readonly api: NativeApi;
  readonly form: KeyForm;
}

const COMBINATIONS: readonly Combination[] = NATIVE_APIS.flatMap((api) =>
  KEY_FORMS.map((form) => ({ provider: `${api.api}-${form.name}`, api, form })),
);
const MODEL = "reasoner";
const AFFINITY_HEADER = "x-affinity";
const NO_AFFINITY: Combination = {
  provider: "no-affinity",
  api: COMPLETIONS,
  form: LITERAL_KEY,
};
const answerFrom = (provider: string): string => `answer from ${provider}`;

function providerConfig(baseUrl: string, { provider, api, form }: Combination): unknown {
  return {
    baseURL: `${baseUrl}/${provider}/v1`,
    api: api.api,
    apiKey: form.apiKey,
    compat: api.compat,
    ...(form.authorizationHeader ? { authHeader: "authorization" } : {}),
    ...(provider === NO_AFFINITY.provider ? {} : { sessionAffinityHeader: AFFINITY_HEADER }),
  };
}

function nativeGateway(request: RecordedRequest): Reply {
  const path = request.url.split("?")[0] ?? "";
  if (path.endsWith("/v1/models")) return json({ data: [{ id: MODEL, reasoning: true }] });
  const route = [...COMBINATIONS, NO_AFFINITY].find(
    ({ provider, api }) => path === `/${provider}${api.chatPath}`,
  );
  if (route === undefined) return json({ error: `no route for ${path}` }, 404);
  return route.api.reply(answerFrom(route.provider));
}

async function roundTrips(client: RpcClient, remaining: readonly Combination[]): Promise<void> {
  const [next, ...rest] = remaining;
  if (next === undefined) return;
  const selected = await client.send({
    type: "set_model",
    provider: next.provider,
    modelId: MODEL,
  });
  assert.equal(selected["success"], true, `${next.provider}: ${JSON.stringify(selected)}`);
  await client.prompt(`hello ${next.provider}`);
  const answer = await client.send({ type: "get_last_assistant_text" });
  assert.deepEqual(answer["data"], { text: answerFrom(next.provider) }, next.provider);
  await roundTrips(client, rest);
}

function assertAuth(request: RecordedRequest, { provider, api, form }: Combination): void {
  const context = `${provider} ${request.url}`;
  if (api.api === "anthropic-messages" && !form.authorizationHeader) {
    assert.equal(request.headers["x-api-key"], form.key, context);
    assert.equal(request.headers["authorization"], undefined, context);
    return;
  }
  assert.equal(request.headers["authorization"], `Bearer ${form.key}`, context);
}

/** Asserts what every combination sends, and returns its one chat request. */
function assertWire(
  requests: readonly RecordedRequest[],
  combination: Combination,
): RecordedRequest {
  const { provider, api } = combination;
  const own = requests.filter((request) => request.url.startsWith(`/${provider}/`));
  const discovery = own.filter((request) => request.url === `/${provider}/v1/models`);
  assert.ok(discovery.length > 0, `${provider} discovery`);
  for (const request of discovery) assertAuth(request, combination);
  const chats = own.filter((request) => !discovery.includes(request));
  assert.equal(chats.length, 1, `${provider} chat requests`);
  const [chat] = chats;
  assert.ok(chat !== undefined);
  assert.equal(chat.url.split("?")[0], `/${provider}${api.chatPath}`);
  assertAuth(chat, combination);
  const body = bodyOf(chat);
  assert.ok(api.compatReached(body), `${provider} compat missing: ${chat.body}`);
  assert.ok(!api.thinkingDisabled(body), `${provider} invented a disabled effort: ${chat.body}`);
  return chat;
}

scenario(
  "all native APIs and key forms round trip with affinity, compat, and the off default",
  ONLINE,
  async ({ world, server, rpc }) => {
    world.mergeSettings({ retry: { enabled: false } });
    const gateway = await server(nativeGateway);
    const all = [...COMBINATIONS, NO_AFFINITY];
    world.writeAgentFile("custom-provider.json", {
      modelsDev: false,
      providers: Object.fromEntries(
        all.map((combination) => [
          combination.provider,
          providerConfig(gateway.baseUrl, combination),
        ]),
      ),
    });
    const client = rpc(["--no-session", "--approve", "--tools", "read", "--thinking", "off"]);
    const models = modelKeys(await client.send({ type: "get_available_models" }));
    for (const { provider } of all) assert.ok(models.includes(`${provider}/${MODEL}`), provider);
    await roundTrips(client, all);
    const state = await client.send({ type: "get_state" });
    const sessionId = isRecord(state["data"]) ? state["data"]["sessionId"] : undefined;
    assert.equal(typeof sessionId, "string");
    assert.equal(COMBINATIONS.length, 12);
    for (const combination of COMBINATIONS) {
      const chat = assertWire(gateway.requests, combination);
      assert.equal(chat.headers[AFFINITY_HEADER], sessionId, `${combination.provider} affinity`);
    }
    const unconfigured = assertWire(gateway.requests, NO_AFFINITY);
    assert.ok(!(AFFINITY_HEADER in unconfigured.headers), "only the configured provider sends it");
    assert.deepEqual(client.extensionErrors(), []);
  },
);
