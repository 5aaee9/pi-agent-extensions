/**
 * Interrogate a hand-written provider route for the reasoning levels its
 * endpoint advertises.
 *
 * The request follows the Harness's own discovery contract — the same listing
 * URL, the same attribution headers, and the same authentication per protocol
 * — so a deployment whose Models page can list a route's models gets the same
 * request here, only with the reasoning half of each entry kept.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/discovery
 */

import { attributionHeaders } from "@deepseek-ai/dsh-llm";

import { readManifestListing, readModelListing, type ListedModel } from "./reasoning.ts";

/** Protocols whose model listing this build reads. */
const LISTABLE_APIS: ReadonlySet<string> = new Set([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
]);

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Largest model-list page accepted by Anthropic's public endpoint. */
const ANTHROPIC_MODEL_LIMIT = 1000;

/** Replies larger than this are refused rather than parsed. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The capability manifest a Codex-shaped relay publishes at its root. */
const MANIFEST_PATH = "/backend-api/codex/models";

/** A route's endpoint with a trailing `/v1` removed. */
function rootUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base.slice(0, -3) : base;
}

/**
 * Join an endpoint base with its protocol's listing path.
 *
 * The base is treated as a prefix rather than a URL to resolve against, so a
 * deployment path survives; the Anthropic listing lives at the root `/v1`
 * whether or not the base's `/v1` is spelled out.
 *
 * @param baseURL - the route's configured endpoint.
 * @param api - the route's wire protocol.
 * @returns the listing URL.
 */
export function listingUrl(baseURL: string, api: string): string {
  const base = baseURL.replace(/\/+$/, "");
  if (api !== "anthropic-messages") return `${base}/models`;
  return `${rootUrl(base)}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`;
}

/**
 * Join an endpoint base with its Codex-shaped capability manifest path.
 *
 * @param baseURL - the route's configured endpoint.
 * @returns the manifest URL.
 */
export function manifestUrl(baseURL: string): string {
  return `${rootUrl(baseURL)}${MANIFEST_PATH}`;
}

/**
 * Whether a protocol is served by a relay that may publish a Codex manifest.
 *
 * The manifest is a Codex backend's own model list, so only the Responses
 * protocol — the shape a Codex relay proxies — is consulted for it.
 *
 * @param api - the route's wire protocol.
 * @returns true when {@link probeManifest} should be attempted for the route.
 */
export function hasCodexManifest(api: string): boolean {
  return api === "openai-responses";
}

/**
 * Whether this build can read a protocol's model listing.
 *
 * @param api - the route's wire protocol.
 * @returns true for a protocol {@link probeRoute} interrogates.
 */
export function isListableApi(api: string): boolean {
  return LISTABLE_APIS.has(api);
}

/** One route interrogation. */
export interface RouteProbe {
  /** Provider route key, for diagnostics. */
  readonly route: string;
  /** The route's configured endpoint. */
  readonly baseURL: string;
  /** The route's wire protocol. */
  readonly api: string;
  /** The route's own configured request headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The credential resolved for the route, when one was found. */
  readonly apiKey?: string;
  /** Caller cancellation. */
  readonly signal?: AbortSignal;
  /** Transport override, for tests; the process `fetch` by default. */
  readonly fetchImpl?: typeof fetch;
}

/** Read a reply body, refusing one that outgrows the ceiling. */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): Error =>
    new Error(`${url} answered with more than ${String(MAX_RESPONSE_BYTES)} bytes`);
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw oversized();
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw oversized();
  return text;
}

/** The headers one route interrogation sends, whatever path it asks for. */
function requestHeaders(probe: RouteProbe): Headers {
  const headers = new Headers(
    probe.headers === undefined ? undefined : Object.entries(probe.headers),
  );
  headers.set("accept", "application/json");
  if (probe.api === "anthropic-messages") {
    headers.set("anthropic-version", ANTHROPIC_VERSION);
    if (probe.apiKey !== undefined) headers.set("x-api-key", probe.apiKey);
  } else if (probe.apiKey !== undefined) {
    headers.set("authorization", `Bearer ${probe.apiKey}`);
  }
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value);
  return headers;
}

/**
 * Interrogate one route's endpoint for the models it advertises and the levels
 * each one publishes.
 *
 * @param probe - the endpoint, protocol, headers, and credential to use.
 * @returns the advertised models in endpoint order.
 * @throws Error when the protocol has no readable listing, the endpoint refuses
 *   or fails the request, or the reply is not a model listing.
 */
export async function probeRoute(probe: RouteProbe): Promise<ListedModel[]> {
  if (!isListableApi(probe.api)) {
    throw new Error(
      `route "${probe.route}" speaks "${probe.api}", which has no model listing this build can read; declare its levels with reasoningEfforts instead`,
    );
  }
  const url = listingUrl(probe.baseURL, probe.api);
  const headers = requestHeaders(probe);

  const fetchImpl = probe.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers, signal: probe.signal });
  } catch (error) {
    throw new Error(
      `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "; check the API key for that route"
        : "";
    throw new Error(`${url} answered ${String(response.status)}${hint}`);
  }
  const text = await readBounded(response, url);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(`${url} did not answer with JSON`, { cause: error });
  }
  return readModelListing(body);
}

/**
 * Interrogate one route's Codex-shaped capability manifest.
 *
 * A relay that proxies a Codex backend publishes the backend's own model list at
 * `/backend-api/codex/models`, with the efforts each model accepts. The endpoint
 * is optional: a relay that does not have it answers `403`, `404`, an HTML error
 * page, or some other JSON, all of which mean "no manifest" rather than a
 * failure. A request that never completed or a status the endpoint owned is
 * still an error, so a relay that is down is visible.
 *
 * @param probe - the endpoint, headers, and credential to use.
 * @returns the manifest's models, or `undefined` when the relay has none.
 * @throws Error when the endpoint could not be reached or answered with a status
 *   other than "not found" and "forbidden".
 */
export async function probeManifest(probe: RouteProbe): Promise<ListedModel[] | undefined> {
  const url = manifestUrl(probe.baseURL);
  const fetchImpl = probe.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: requestHeaders(probe),
      signal: probe.signal,
    });
  } catch (error) {
    throw new Error(
      `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (response.status === 403 || response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  const text = await readBounded(response, url);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  return readManifestListing(body);
}
