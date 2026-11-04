// Real HTTP servers on the loopback interface. Pi's own clients reach them, so
// assertions hold on the request Pi sent and on how it handled the reply.
import { on, once } from "node:events";
import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { zstdDecompressSync } from "node:zlib";

import { isRecord } from "../../release/json.ts";

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: string;
}

export interface Reply {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly chunks?: readonly string[];
  /** Resolves when the reply may start, to hold a request in flight. */
  readonly gate?: () => Promise<void>;
  /** Resolves when a streamed reply may end, to hold a stream open mid-way. */
  readonly holdOpen?: () => Promise<void>;
}

export type Handler = (request: RecordedRequest) => Promise<Reply> | Reply;

export interface LocalServer {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: readonly RecordedRequest[];
  readonly close: () => Promise<void>;
}

export function json(value: unknown, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "application/json" },
    chunks: [JSON.stringify(value)],
  };
}

export const sse = (
  chunks: readonly string[],
  extra: Pick<Reply, "gate" | "holdOpen"> = {},
): Reply => ({
  status: 200,
  headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  chunks,
  ...extra,
});

function portOf(address: unknown): number {
  if (!isRecord(address) || typeof address["port"] !== "number")
    throw new Error("server did not report a port");
  return address["port"];
}

export async function startServer(handler: Handler, port = 0): Promise<LocalServer> {
  const server = createServer();
  const stop = new AbortController();
  const requests: RecordedRequest[] = [];
  const serve = async (): Promise<void> => {
    for await (const args of on(server, "request", { signal: stop.signal })) {
      const pair: unknown = args;
      const items: readonly unknown[] = Array.isArray(pair) ? pair : [];
      const [request, response] = items;
      if (!(request instanceof IncomingMessage && response instanceof ServerResponse)) continue;
      void (async (): Promise<void> => {
        const raw = await buffer(request);
        const encoded = request.headers["content-encoding"] === "zstd";
        const recorded: RecordedRequest = {
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers,
          body: (encoded ? zstdDecompressSync(raw) : raw).toString("utf8"),
        };
        requests.push(recorded);
        const reply = await handler(recorded);
        await reply.gate?.();
        if (response.destroyed) return;
        response.writeHead(reply.status ?? 200, reply.headers);
        for (const chunk of reply.chunks ?? []) response.write(chunk);
        await reply.holdOpen?.();
        response.end();
      })().catch(() => {
        response.destroy();
      });
    }
  };
  void serve().catch((error: unknown) => {
    if (!stop.signal.aborted) throw error;
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const boundPort = portOf(server.address());
  return {
    baseUrl: `http://127.0.0.1:${String(boundPort)}`,
    port: boundPort,
    requests,
    async close() {
      stop.abort();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

const SUMMARIZER_MARKER = "context summarization assistant";

/** Whether a request came from Pi's summarizer rather than a session turn. */
export const isSummaryRequest = (request: RecordedRequest): boolean =>
  request.body.includes(SUMMARIZER_MARKER);

export const isChatRequest = (request: RecordedRequest): boolean =>
  request.url.includes("/chat/completions");

export function bodyOf(request: RecordedRequest): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(request.body);
  if (!isRecord(value)) throw new Error(`request body is not a JSON object: ${request.body}`);
  return value;
}

export interface ChatToolCall {
  readonly name: string;
  readonly arguments: string;
}

export interface ChatReply {
  readonly text?: string;
  readonly thinking?: string;
  readonly toolCall?: ChatToolCall;
  readonly promptTokens?: number;
  /** Fails the request with this status and error message. */
  readonly failure?: { readonly status: number; readonly message: string };
  readonly gate?: () => Promise<void>;
  /** Sends the text, then holds the stream open until this resolves. */
  readonly holdOpen?: () => Promise<void>;
}

export type ChatScript = (request: RecordedRequest) => ChatReply;

function chatChunk(delta: unknown, finishReason: string | null, usage?: unknown): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage === undefined ? {} : { usage }),
  })}\n\n`;
}

function toolCallChunk(call: ChatToolCall): string {
  const toolCalls = [
    {
      index: 0,
      id: "call_e2e",
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    },
  ];
  return chatChunk({ role: "assistant", tool_calls: toolCalls }, null);
}

export function chatReply(reply: ChatReply): Reply {
  if (reply.failure !== undefined) {
    const failed = json({ error: { message: reply.failure.message } }, reply.failure.status);
    return reply.gate === undefined ? failed : { ...failed, gate: reply.gate };
  }
  const promptTokens = reply.promptTokens ?? 10;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: 2,
    total_tokens: promptTokens + 2,
  };
  const body =
    reply.toolCall === undefined
      ? chatChunk({ role: "assistant", content: reply.text ?? "ok" }, null)
      : toolCallChunk(reply.toolCall);
  const finish = reply.toolCall === undefined ? "stop" : "tool_calls";
  const thinking =
    reply.thinking === undefined
      ? []
      : [chatChunk({ role: "assistant", reasoning_content: reply.thinking }, null)];
  const tail =
    reply.holdOpen === undefined ? [chatChunk({}, finish, usage), "data: [DONE]\n\n"] : [];
  return sse([...thinking, body, ...tail], {
    ...(reply.gate === undefined ? {} : { gate: reply.gate }),
    ...(reply.holdOpen === undefined ? {} : { holdOpen: reply.holdOpen }),
  });
}

/** An OpenAI-compatible chat-completions endpoint. */
export async function startChatServer(script: ChatScript = () => ({})): Promise<LocalServer> {
  const server = await startServer((request) =>
    isChatRequest(request) ? chatReply(script(request)) : json({ error: "not found" }, 404),
  );
  return server;
}
