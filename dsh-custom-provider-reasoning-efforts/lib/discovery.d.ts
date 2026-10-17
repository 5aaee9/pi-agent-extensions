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
//# sourceMappingURL=discovery.d.ts.map