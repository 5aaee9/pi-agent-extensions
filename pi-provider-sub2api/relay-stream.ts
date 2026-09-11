import { isDeepStrictEqual } from "node:util";

import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { CODEX_API } from "./codex-api.ts";
import { FAST_MODE_APIS, OPENAI, RESPONSES_SERVER_TOOL_API, relaysByProvider } from "./types.ts";
import type { RelayConfig, SupportedApi } from "./types.ts";
import { asRecord } from "./util.ts";

export function createRelayFetch(
  relay: RelayConfig,
  upstreamFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    if (url !== relay.codexResponsesUrl) return upstreamFetch(input, init);

    const headers = new Headers(init?.headers ?? request?.headers);
    const hasRelayIdentity =
      headers.get("Authorization") === `Bearer ${relay.codexAuthToken}` &&
      headers.get("chatgpt-account-id") === relay.accountId;
    if (!hasRelayIdentity) return upstreamFetch(input, init);

    // Sub2API relays do not expose ChatGPT's Codex passthrough route; rewrite
    // the request to the standard Responses endpoint, drop the fake account
    // identity, and replace only the fake JWT with the real relay credential.
    headers.set("Authorization", `Bearer ${relay.apiKey}`);
    headers.delete("chatgpt-account-id");
    return upstreamFetch(relay.responsesUrl, { ...init, headers, redirect: "error" });
  };
}

export function streamCodex(
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions = {},
): AssistantMessageEventStream {
  const relay = relaysByProvider.get(model.provider);
  if (!CODEX_API) throw new Error("pi Codex adapter unavailable on this host");
  if (!relay) return CODEX_API.streamSimple(model, context, options);

  // Failed requests surface as ordinary stream errors so Pi's own retry
  // handling can retry the turn.
  const upstreamFetch = options.fetch ?? globalThis.fetch;
  return CODEX_API.streamSimple(model, context, {
    ...options,
    apiKey: relay.codexAuthToken,
    transport: "sse",
    fetch: createRelayFetch(relay, upstreamFetch),
  });
}

export function addServerTools(payload: unknown, model: Model<any> | undefined) {
  if (!model) return undefined;
  const relay = relaysByProvider.get(model.provider);
  if (!relay?.serverTools) return undefined;

  const configuredTools =
    RESPONSES_SERVER_TOOL_API[model.api as SupportedApi] === true
      ? relay.serverTools.responses
      : model.api === "anthropic-messages"
        ? relay.serverTools.anthropic
        : [];
  if (configuredTools.length === 0) return undefined;

  const request = asRecord(payload);
  if (!request || request.model !== model.id) return undefined;
  if (request.tools !== undefined && !Array.isArray(request.tools)) return undefined;

  const tools = [...((request.tools as unknown[] | undefined) ?? [])];
  let changed = false;
  for (const configuredTool of configuredTools) {
    if (tools.some((tool) => isDeepStrictEqual(tool, configuredTool))) continue;
    tools.push(structuredClone(configuredTool));
    changed = true;
  }
  return changed ? { ...request, tools } : undefined;
}

export function addFastServiceTier(payload: unknown, model: Model<any> | undefined) {
  if (
    !model ||
    !relaysByProvider.has(model.provider) ||
    !OPENAI.test(model.id) ||
    !FAST_MODE_APIS.has(model.api as SupportedApi)
  ) {
    return undefined;
  }
  const request = asRecord(payload);
  if (!request || request.model !== model.id) return undefined;
  return { ...request, service_tier: "priority" };
}
