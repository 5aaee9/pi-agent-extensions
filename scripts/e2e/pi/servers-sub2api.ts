// A Sub2API relay on loopback, speaking what `pi-provider-sub2api` and Pi's own
// adapters need: discovery, billing, usage, Responses, Messages, and Completions,
// plus remote compaction. Every route can be replaced and failures injected.

import { isRecord } from "../../release/json.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf, chatReply, isSummaryRequest, json } from "./servers.ts";
import type { LocalServer, RecordedRequest, Reply } from "./servers.ts";
import {
  NOT_FOUND,
  anthropicReply,
  compactionReply,
  textReply,
} from "./servers-sub2api-replies.ts";

const REQUEST_WAIT_MS = 30_000;

export const isCompactionRequest = (request: RecordedRequest): boolean => {
  const { input } = bodyOf(request);
  if (!Array.isArray(input)) return false;
  const last: unknown = input.at(-1);
  return isRecord(last) && last["type"] === "compaction_trigger";
};

export type Route = (request: RecordedRequest) => Reply;

export interface RelayRoutes {
  readonly manifest: Route;
  readonly inventory: Route;
  readonly billing: Route;
  readonly usage: Route;
  readonly turn: Route;
  readonly compaction: Route;
  readonly summary: Route;
  readonly messages: Route;
  readonly completions: Route;
}

export const manifestOf =
  (models: readonly unknown[]): Route =>
  () =>
    json({ models });

export const inventoryOf =
  (models: readonly unknown[]): Route =>
  () =>
    json({ data: models });

const DEFAULT_ROUTES: RelayRoutes = {
  manifest: NOT_FOUND,
  inventory: NOT_FOUND,
  billing: NOT_FOUND,
  usage: NOT_FOUND,
  turn: () => textReply(),
  compaction: () => compactionReply(),
  summary: () => textReply("textual summary"),
  messages: () => anthropicReply(),
  completions: () => chatReply({ text: "pong" }),
};

export interface Relay extends LocalServer {
  readonly v1: string;
  readonly route: (routes: Partial<RelayRoutes>) => void;
  /** Answers the next session turns with these replies, then the route again. */
  readonly queueTurns: (...replies: readonly Reply[]) => void;
  readonly at: (path: string) => readonly RecordedRequest[];
  readonly turns: () => readonly RecordedRequest[];
  readonly compactions: () => readonly RecordedRequest[];
  readonly summaries: () => readonly RecordedRequest[];
  /** Resolves once this many requests have reached `path`. */
  readonly waitFor: (path: string, count: number) => Promise<void>;
}

const pathOf = (request: RecordedRequest): string => request.url.split("?")[0] ?? "";

interface ReplyQueue {
  readonly next: () => Reply | undefined;
}

function responsesRoute(
  request: RecordedRequest,
  routes: RelayRoutes,
  queued: ReplyQueue,
): Reply | undefined {
  if (request.method !== "POST") return undefined;
  if (isCompactionRequest(request)) return routes.compaction(request);
  if (isSummaryRequest(request)) return routes.summary(request);
  return queued.next() ?? routes.turn(request);
}

function dispatch(request: RecordedRequest, routes: RelayRoutes, queued: ReplyQueue): Reply {
  const path = pathOf(request);
  if (path === "/backend-api/codex/models") return routes.manifest(request);
  if (path === "/v1/models") return routes.inventory(request);
  if (path === "/v1/sub2api/billing") return routes.billing(request);
  if (path === "/usage" || path === "/v1/usage") return routes.usage(request);
  if (path === "/v1/responses")
    return responsesRoute(request, routes, queued) ?? json({ error: "bad method" }, 405);
  if (path === "/v1/messages") return routes.messages(request);
  if (path === "/v1/chat/completions") return routes.completions(request);
  return json({ error: `no route for ${path}` }, 404);
}

interface PendingRequestWait {
  readonly check: () => boolean;
  readonly settle: () => void;
}

interface RequestWaits {
  readonly flush: () => void;
  readonly until: (reached: () => boolean, label: string) => Promise<void>;
}

function requestWaits(): RequestWaits {
  const pending = new Set<PendingRequestWait>();
  return {
    flush() {
      for (const wait of pending)
        if (wait.check()) {
          pending.delete(wait);
          wait.settle();
        }
    },
    async until(reached, label) {
      if (reached()) return;
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const wait: PendingRequestWait = { check: reached, settle: resolve };
      pending.add(wait);
      const timer = setTimeout(() => {
        pending.delete(wait);
        reject(new Error(`timed out waiting for ${label}`));
      }, REQUEST_WAIT_MS);
      try {
        await promise;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function startRelay(
  start: Scenario["server"],
  initial: Partial<RelayRoutes> = {},
  port?: number,
): Promise<Relay> {
  let routes: RelayRoutes = { ...DEFAULT_ROUTES, ...initial };
  const queued: Reply[] = [];
  const waits = requestWaits();
  const server = await start((request) => {
    waits.flush();
    return dispatch(request, routes, { next: () => queued.shift() });
  }, port);
  const at = (path: string): readonly RecordedRequest[] =>
    server.requests.filter((request) => pathOf(request) === path);
  const responses = (): readonly RecordedRequest[] =>
    at("/v1/responses").filter((request) => request.method === "POST");
  return {
    ...server,
    v1: `${server.baseUrl}/v1`,
    route(next) {
      routes = { ...routes, ...next };
    },
    queueTurns(...replies) {
      queued.push(...replies);
    },
    at,
    turns: () =>
      responses().filter((request) => !isCompactionRequest(request) && !isSummaryRequest(request)),
    compactions: () => responses().filter((request) => isCompactionRequest(request)),
    summaries: () => responses().filter((request) => isSummaryRequest(request)),
    waitFor: async (path, count) => {
      const reached = (): boolean => at(path).length >= count;
      const label = `${String(count)} request(s) to ${path}`;
      await waits.until(reached, label);
    },
  };
}

export const headerOf = (
  request: RecordedRequest | undefined,
  name: string,
): string | undefined => {
  const value = request?.headers[name];
  return typeof value === "string" ? value : value?.join(",");
};
