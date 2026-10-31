/**
 * A locally started OpenAI-compatible endpoint for the real-plane tests.
 *
 * The pinned host's own `@deepseek-ai/dsh-llm-pi-ai` adapter reaches it through
 * its real HTTP client (`docs/conventions.md`, "Tests": network-shaped code runs
 * against a real server, a locally started one where no credential is needed).
 * It answers the two requests that adapter makes for a hand-declared
 * `openai-completions` route — `GET /v1/models` and a streamed
 * `POST /v1/chat/completions` — with the wire protocol's real shapes, including
 * the final usage chunk the host turns into its `contextPressure` projection.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The model id the local route serves. */
export const LOCAL_MODEL = "local-model";

export interface ModelServer {
  /** The route's `baseURL`, ending in `/v1`. */
  readonly baseURL: string;
  /** The number of chat completions the server answered. */
  completions(): number;
  close(): Promise<void>;
}

export interface ModelServerOptions {
  /** Prompt tokens each reply reports in its usage chunk. */
  readonly promptTokens: number;
  /** Text each reply streams. */
  readonly reply?: string;
}

function sse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function drain(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) {
    // The body is consumed so the connection can be reused; its content is not asserted.
  }
}

/** Start the endpoint on a free loopback port. */
export async function startModelServer(options: ModelServerOptions): Promise<ModelServer> {
  let completions = 0;
  const reply = options.reply ?? "Done.";
  const server = createServer((request, response) => {
    void (async () => {
      await drain(request);
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method === "GET" && path === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ object: "list", data: [{ id: LOCAL_MODEL, object: "model" }] }),
        );
        return;
      }
      if (request.method === "POST" && path === "/v1/chat/completions") {
        completions += 1;
        const id = `chatcmpl-${String(completions)}`;
        const base = { id, object: "chat.completion.chunk", created: 0, model: LOCAL_MODEL };
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        sse(response, {
          ...base,
          choices: [
            { index: 0, delta: { role: "assistant", content: reply }, finish_reason: null },
          ],
        });
        sse(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        sse(response, {
          ...base,
          choices: [],
          usage: {
            prompt_tokens: options.promptTokens,
            completion_tokens: 2,
            total_tokens: options.promptTokens + 2,
          },
        });
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: `no route for ${request.method ?? ""} ${path}` } }),
      );
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    completions: () => completions,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
