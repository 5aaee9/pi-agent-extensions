/**
 * A locally started OpenAI-compatible endpoint for the real model stack.
 *
 * The real `@deepseek-ai/dsh-llm-pi-ai` adapter is mounted with one declared
 * `openai-completions` route whose `baseURL` points here, so the real pi-ai HTTP
 * client sends the real request (headers, body, abort) and parses the real SSE
 * wire format this server answers with. No stream, adapter, or model resolution is
 * injected into the host: the test only decides what the endpoint says
 * (`docs/conventions.md`, "Tests"; real-environment-testing spec, "Network-shaped
 * code is exercised through a real client").
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One chat-completions request as the endpoint received it. */
export interface ReceivedRequest {
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Record<string, unknown>;
}

/** What the endpoint does with one request. */
export interface Exchange {
  readonly request: ReceivedRequest;
  /** Write one OpenAI chat-completions chunk as an SSE `data:` line. */
  chunk(delta: Record<string, unknown>, finishReason?: string | null): void;
  /** Write the terminal `data: [DONE]` line and close the stream. */
  done(): void;
  /** Close the response without a terminal line. */
  end(): void;
  /** Answer with a non-streaming HTTP failure. */
  fail(status: number, message: string): void;
  /** Resolves once the client hung up (an abort reached the wire). */
  readonly closed: Promise<void>;
}

export type Responder = (exchange: Exchange) => void | Promise<void>;

/** A running endpoint plus everything it received. */
export interface ModelServer {
  /** Base URL to configure as the route's `baseURL`. */
  readonly baseURL: string;
  readonly requests: ReceivedRequest[];
  /** Replace how the next requests are answered. */
  respond(responder: Responder): void;
  close(): Promise<void>;
}

/** Reply with plain text, finished with `stop`. */
export function replyText(text: string): Responder {
  return (exchange) => {
    exchange.chunk({ role: "assistant", content: text });
    exchange.chunk({}, "stop");
    exchange.done();
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  const text = Buffer.concat(parts).toString("utf8");
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

/**
 * Start the endpoint on a free loopback port.
 * @param responder - initial behaviour; defaults to a plain text reply.
 * @returns the running server; the caller must close it.
 */
export async function startModelServer(
  responder: Responder = replyText("Add a regression test"),
): Promise<ModelServer> {
  let current = responder;
  const requests: ReceivedRequest[] = [];
  const open = new Set<ServerResponse>();
  const server = createServer((incoming, response) => {
    open.add(response);
    response.on("close", () => open.delete(response));
    void (async () => {
      const received: ReceivedRequest = {
        path: incoming.url ?? "",
        headers: incoming.headers,
        body: await readBody(incoming),
      };
      requests.push(received);
      let started = false;
      const start = (): void => {
        if (started) return;
        started = true;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
      };
      const closed = new Promise<void>((resolve) => {
        response.once("close", () => resolve());
      });
      const model = typeof received.body["model"] === "string" ? received.body["model"] : "";
      const exchange: Exchange = {
        request: received,
        chunk(delta, finishReason = null) {
          start();
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-local",
              object: "chat.completion.chunk",
              created: 0,
              model,
              choices: [{ index: 0, delta, finish_reason: finishReason }],
            })}\n\n`,
          );
        },
        done() {
          start();
          response.end("data: [DONE]\n\n");
        },
        end() {
          start();
          response.end();
        },
        fail(status, message) {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message, type: "local_error" } }));
        },
        closed,
      };
      await current(exchange);
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    respond(next) {
      current = next;
    },
    async close() {
      for (const response of open) response.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
