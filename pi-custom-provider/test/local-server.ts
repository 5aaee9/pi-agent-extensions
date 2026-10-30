import { createServer, type IncomingHttpHeaders } from "node:http";

/**
 * A real HTTP server bound to an ephemeral loopback port. Tests point the
 * extension's `baseURL`/`modelsURL` at it and let the package's own fetch
 * (undici) make the request, so routing, headers, auth shape, and error
 * statuses are observed from the wire rather than from a stubbed `fetch`.
 */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface LocalResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface LocalServer {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

export function jsonResponse(value: unknown, status = 200): LocalResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function unavailable(): LocalResponse {
  return { status: 503, headers: { "content-type": "text/plain" }, body: "unavailable" };
}

export function notFound(): LocalResponse {
  return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
}

export async function startLocalServer(
  handle: (request: RecordedRequest) => LocalResponse,
): Promise<LocalServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const recorded: RecordedRequest = {
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      const result = handle(recorded);
      response.writeHead(result.status ?? 200, result.headers ?? {});
      response.end(result.body ?? "");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("local server did not bind a TCP port");
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // The real client keeps pooled sockets alive; drop them so a closed
        // server is observably unreachable to the next request.
        server.closeAllConnections();
      });
    },
  };
}
