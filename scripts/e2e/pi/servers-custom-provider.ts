// Protocol replies for `pi-custom-provider`: Ollama's NDJSON chat with its
// `/api/tags` and `/api/show` discovery, and the two native SSE streams Pi's own
// clients read. Handlers plug into `startServer` through `Scenario.server`.
import { json, sse } from "./servers.ts";
import type { Handler, RecordedRequest, Reply } from "./servers.ts";

export type OllamaChunk = Readonly<Record<string, unknown>>;

export const ollamaText = (content: string): OllamaChunk => ({
  message: { role: "assistant", content },
  done: false,
});

export const ollamaThinking = (thinking: string): OllamaChunk => ({
  message: { role: "assistant", thinking },
  done: false,
});

export const OLLAMA_DONE: OllamaChunk = {
  message: { role: "assistant", content: "" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 2,
};

export const ndjson = (
  chunks: readonly OllamaChunk[],
  extra: Pick<Reply, "holdOpen"> = {},
): Reply => ({
  status: 200,
  headers: { "content-type": "application/x-ndjson" },
  chunks: chunks.map((chunk) => `${JSON.stringify(chunk)}\n`),
  ...extra,
});

export const OLLAMA_CHAT_PATH = "/api/chat";
export const isOllamaChat = (request: RecordedRequest): boolean => request.url === OLLAMA_CHAT_PATH;

/** An Ollama daemon whose models all report tools and thinking. */
export function ollamaHandler(
  models: readonly string[],
  chat: (request: RecordedRequest) => Reply,
): Handler {
  return (request) => {
    if (request.url === "/api/tags") return json({ models: models.map((model) => ({ model })) });
    if (request.url === "/api/show")
      return json({
        capabilities: ["completion", "tools", "thinking"],
        model_info: { "test.context_length": 32_768 },
      });
    return isOllamaChat(request) ? chat(request) : json({ error: "not found" }, 404);
  };
}

const sseEvent = (type: string, data: Readonly<Record<string, unknown>>): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** A complete OpenAI Responses stream that answers with `text`. */
export function responsesReply(text: string): Reply {
  const item = { type: "message", id: "msg_e2e", role: "assistant", status: "completed" };
  const part = { type: "output_text", text };
  const usage = {
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    input_tokens_details: { cached_tokens: 0 },
  };
  return sse([
    sseEvent("response.output_item.added", {
      item: { ...item, status: "in_progress", content: [] },
    }),
    sseEvent("response.content_part.added", { part: { ...part, text: "" } }),
    sseEvent("response.output_text.delta", { delta: text }),
    sseEvent("response.output_item.done", { item: { ...item, content: [part] } }),
    sseEvent("response.completed", {
      response: { id: "resp_e2e", status: "completed", usage },
    }),
  ]);
}

/** A complete Anthropic Messages stream that answers with `text`. */
export function anthropicReply(text: string): Reply {
  return sse([
    sseEvent("message_start", {
      message: {
        id: "msg_e2e",
        role: "assistant",
        content: [],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    sseEvent("content_block_stop", { index: 0 }),
    sseEvent("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
    sseEvent("message_stop", {}),
  ]);
}
