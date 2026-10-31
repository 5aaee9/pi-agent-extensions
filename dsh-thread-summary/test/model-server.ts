/**
 * A locally started OpenAI-compatible Chat Completions endpoint. The real
 * `@deepseek-ai/dsh-llm-pi-ai` adapter reaches it through the real pi-ai HTTP
 * client, so routing, headers, streaming, aborts and error statuses are what
 * the real stack does; only the far end of the wire is local. Each request is
 * answered by the next queued script, so a test states exactly what the
 * endpoint says and when.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PiAiProviderProfile } from "@deepseek-ai/dsh-llm-pi-ai";

/** One exchange as the endpoint observed it. */
export interface ModelRequest {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  /** Resolves when the client closes the connection (finished or aborted). */
  readonly closed: Promise<void>;
  /** Whether the client went away before the script finished writing. */
  aborted(): boolean;
}

/** Writes the reply for one request; `send` emits one SSE `data:` frame. */
export interface ModelReply {
  readonly request: ModelRequest;
  status(code: number, body: unknown): void;
  send(delta: Record<string, unknown>, finishReason?: string | null): void;
  done(): void;
  /** End the stream without `[DONE]` (and without a finish reason unless one was sent). */
  end(): void;
}

export type ModelScript = (reply: ModelReply) => Promise<void> | void;

export interface ModelServer {
  readonly baseURL: string;
  readonly requests: ModelRequest[];
  /** Queue the answer for the next request. */
  enqueue(script: ModelScript): void;
  close(): Promise<void>;
}

export const MODEL_API_KEY_ENV = "THREAD_SUMMARY_TEST_MODEL_KEY";
export const MODEL_API_KEY = "local-test-key";

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

/** A text reply streamed as the given deltas and finished with `finishReason`. */
export function streamText(
  deltas: readonly string[],
  finishReason: string | null = "stop",
): ModelScript {
  return (reply) => {
    for (const text of deltas) reply.send({ content: text });
    reply.send({}, finishReason);
    reply.done();
  };
}

export async function startModelServer(): Promise<ModelServer> {
  const scripts: ModelScript[] = [];
  const requests: ModelRequest[] = [];
  const open = new Set<ServerResponse>();
  const handle = async (incoming: IncomingMessage, response: ServerResponse): Promise<void> => {
    let gone = false;
    let finished = false;
    const closed = new Promise<void>((resolve) => {
      response.once("close", () => {
        gone = !finished;
        open.delete(response);
        resolve();
      });
    });
    open.add(response);
    const path = incoming.url ?? "";
    const body = await readBody(incoming);
    const request: ModelRequest = {
      path,
      authorization: incoming.headers.authorization,
      body,
      closed,
      aborted: () => gone,
    };
    if (path.endsWith("/models") && incoming.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "summary-model", object: "model" }] }));
      return;
    }
    requests.push(request);
    const script = scripts.shift();
    if (script === undefined) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `no reply queued for ${path}` } }));
      return;
    }
    let headed = false;
    const head = (): void => {
      if (headed) return;
      headed = true;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
    };
    const reply: ModelReply = {
      request,
      status(code, payload) {
        headed = true;
        response.writeHead(code, { "content-type": "application/json" });
        finished = true;
        response.end(JSON.stringify(payload));
      },
      send(delta, finishReason = null) {
        head();
        const frame = {
          id: "chatcmpl-local",
          object: "chat.completion.chunk",
          created: 0,
          model: "summary-model",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        };
        response.write(`data: ${JSON.stringify(frame)}\n\n`);
      },
      done() {
        head();
        finished = true;
        response.end("data: [DONE]\n\n");
      },
      end() {
        head();
        finished = true;
        response.end();
      },
    };
    await script(reply);
  };
  const server: Server = createServer((incoming, response) => {
    handle(incoming, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    enqueue: (script) => {
      scripts.push(script);
    },
    close: async () => {
      for (const response of open) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

/** The `llm-pi-ai` providers section that routes `local/summary-model` to `server`. */
export function localProviders(baseURL: string): Record<string, PiAiProviderProfile> {
  return {
    local: {
      displayName: "Local Summary Endpoint",
      api: "openai-completions",
      baseURL,
      apiKeyEnv: MODEL_API_KEY_ENV,
      models: [
        {
          id: "summary-model",
          name: "Local Summary Model",
          contextWindow: 32_000,
          maxTokens: 4_096,
          reasoningEfforts: false,
        },
      ],
    },
  };
}
