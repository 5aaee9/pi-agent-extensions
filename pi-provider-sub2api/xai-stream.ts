import type {
  Api,
  AssistantMessageEventStream,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";

import { asRecord } from "./util.ts";

type CompatModule = typeof import("@earendil-works/pi-ai/compat");

export const GROK_CLIENT_TOOL_CACHE_HEADER = "X-Sub2API-Grok-Client-Tool-Cache";
const ENCRYPTED_REASONING = "reasoning.encrypted_content";

// The extension loader exposes Pi's public Responses adapter through the compat
// entry point. Hosts without it cannot serve xAI entries; there is no fallback.
async function loadResponsesApi(): Promise<ProviderStreams | undefined> {
  try {
    const compat = (await import("@earendil-works/pi-ai/compat")) as CompatModule;
    if (typeof compat.openAIResponsesApi !== "function") return undefined;
    return compat.openAIResponsesApi();
  } catch {
    return undefined;
  }
}

export const XAI_RESPONSES_API = await loadResponsesApi();

function supportedEfforts(model: Model<Api>) {
  return new Set(
    Object.values(model.thinkingLevelMap ?? {}).filter(
      (effort): effort is string => typeof effort === "string",
    ),
  );
}

// Applied after the caller's payload hooks so they cannot reintroduce stored
// responses, an unsupported effort, or drop encrypted reasoning.
export function normalizeXaiPayload(payload: unknown, model: Model<Api>): unknown {
  const request = asRecord(payload);
  if (!request) return payload;
  const normalized: Record<string, unknown> = { ...request, store: false };
  if (!model.reasoning) return normalized;

  // A level whose mapping is unset (the no-override `off`) makes the adapter send
  // `effort: "none"`; omit any effort the model does not advertise instead.
  const effort = asRecord(normalized.reasoning)?.effort;
  if (
    normalized.reasoning !== undefined &&
    (typeof effort !== "string" || !supportedEfforts(model).has(effort))
  ) {
    delete normalized.reasoning;
  }
  const include = Array.isArray(normalized.include) ? (normalized.include as unknown[]) : [];
  normalized.include = include.includes(ENCRYPTED_REASONING)
    ? include
    : [...include, ENCRYPTED_REASONING];
  return normalized;
}

// Request-scoped: rejects redirects and keeps client functions named web_search or
// x_search local by opting out of Sub2API's Free-account mixed-tool cache route.
export function createXaiFetch(upstreamFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set(GROK_CLIENT_TOOL_CACHE_HEADER, "off");
    return upstreamFetch(input, { ...init, headers, redirect: "error" });
  };
}

export function streamXai(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions = {},
): AssistantMessageEventStream {
  if (!XAI_RESPONSES_API) {
    throw new Error("Pi's OpenAI Responses adapter is unavailable; xAI entries require Pi 1.4.0+");
  }
  const { onPayload } = options;
  return XAI_RESPONSES_API.streamSimple(model, context, {
    ...options,
    onPayload: async (payload, payloadModel) => {
      const replacement = await onPayload?.(payload, payloadModel);
      return normalizeXaiPayload(replacement ?? payload, payloadModel);
    },
    fetch: createXaiFetch(options.fetch ?? globalThis.fetch),
  });
}
