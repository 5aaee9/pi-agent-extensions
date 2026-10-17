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
import { type ListedModel } from "./reasoning.ts";
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
export declare function listingUrl(baseURL: string, api: string): string;
/**
 * Join an endpoint base with its Codex-shaped capability manifest path.
 *
 * @param baseURL - the route's configured endpoint.
 * @returns the manifest URL.
 */
export declare function manifestUrl(baseURL: string): string;
/**
 * Whether a protocol is served by a relay that may publish a Codex manifest.
 *
 * The manifest is a Codex backend's own model list, so only the Responses
 * protocol — the shape a Codex relay proxies — is consulted for it.
 *
 * @param api - the route's wire protocol.
 * @returns true when {@link probeManifest} should be attempted for the route.
 */
export declare function hasCodexManifest(api: string): boolean;
/**
 * Whether this build can read a protocol's model listing.
 *
 * @param api - the route's wire protocol.
 * @returns true for a protocol {@link probeRoute} interrogates.
 */
export declare function isListableApi(api: string): boolean;
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
/**
 * Interrogate one route's endpoint for the models it advertises and the levels
 * each one publishes.
 *
 * @param probe - the endpoint, protocol, headers, and credential to use.
 * @returns the advertised models in endpoint order.
 * @throws Error when the protocol has no readable listing, the endpoint refuses
 *   or fails the request, or the reply is not a model listing.
 */
export declare function probeRoute(probe: RouteProbe): Promise<ListedModel[]>;
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
export declare function probeManifest(probe: RouteProbe): Promise<ListedModel[] | undefined>;
//# sourceMappingURL=discovery.d.ts.map