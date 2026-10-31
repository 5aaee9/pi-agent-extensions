import { createServer, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The provider and model the local server is registered as in `models.json`. */
export const LOCAL_PROVIDER = "probe";
export const LOCAL_MODEL = "retry-model";

export interface RecordedRequest {
  readonly url: string | undefined;
  readonly body: unknown;
}

/**
 * A real OpenAI-compatible chat-completions endpoint started on 127.0.0.1. Pi's
 * pinned provider streams to it with its own HTTP client; nothing replaces a
 * host module, the HTTP client, or an injected stream.
 */
export interface ModelServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  /** Hold the reply to the next request until the returned release is called
   * (or the client aborts the request). */
  holdNext(): () => void;
  /** Resolves once at least `count` requests have arrived. */
  waitForRequests(count: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

function writeReply(response: ServerResponse): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta: object, finishReason: string | null, usage?: object): string =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: LOCAL_MODEL,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage === undefined ? {} : { usage }),
    })}\n\n`;
  response.write(chunk({ role: "assistant", content: "Retried work" }, null));
  response.write(chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }));
  response.end("data: [DONE]\n\n");
}

export async function startModelServer(): Promise<ModelServer> {
  const requests: RecordedRequest[] = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  let holdNext: Promise<void> | undefined;

  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({ url: request.url, body });
      for (const waiter of waiters.splice(0)) {
        if (requests.length >= waiter.count) waiter.resolve();
        else waiters.push(waiter);
      }
      const gate = holdNext;
      holdNext = undefined;
      if (gate === undefined) writeReply(response);
      else void gate.then(() => writeReply(response));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The local model server did not bind a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    requests,
    holdNext: () => {
      let release = (): void => undefined;
      holdNext = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    waitForRequests: (count, timeoutMs = 15_000) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`The local model server saw ${String(requests.length)} request(s)`));
            }, timeoutMs);
            waiters.push({
              count,
              resolve: () => {
                clearTimeout(timer);
                resolve();
              },
            });
          }),
    close: async () => {
      const closed = new Promise<void>((resolve) => {
        server.once("close", () => resolve());
      });
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

/** Register the local server as Pi's `probe` provider in the agent's own `models.json`. */
export async function writeModelsJson(agentDir: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          [LOCAL_PROVIDER]: {
            baseUrl,
            api: "openai-completions",
            apiKey: "local-key",
            models: [
              { id: LOCAL_MODEL, name: "Retry Model", contextWindow: 128_000, maxTokens: 4096 },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

/** Chat content as plain text: providers send either a string or text parts. */
function textOf(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const parts: unknown[] = content;
  if (
    !parts.every(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
  ) {
    return content;
  }
  return parts
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
    )
    .join("");
}

/** The chat messages of a recorded request body, without the system prompt. */
export function conversationOf(request: RecordedRequest | undefined): readonly {
  readonly role: string;
  readonly content: unknown;
}[] {
  if (request === undefined) throw new Error("The model server received no request");
  const body = request.body;
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    throw new Error(`The request carried no chat messages: ${JSON.stringify(body)}`);
  }
  const messages: unknown = body.messages;
  if (!Array.isArray(messages)) throw new Error("The request messages are not an array");
  return messages.flatMap((message: unknown) => {
    if (typeof message !== "object" || message === null) return [];
    const role = "role" in message && typeof message.role === "string" ? message.role : "";
    if (role === "system" || role === "developer") return [];
    return [{ role, content: textOf("content" in message ? message.content : undefined) }];
  });
}
