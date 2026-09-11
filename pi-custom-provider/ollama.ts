// ---------------------------------------------------------------------------
// Ollama chat API (`api: "ollama-chat"`, POST /api/chat over NDJSON)
// ---------------------------------------------------------------------------

import {
  calculateCost,
  clampThinkingLevel,
  createAssistantMessageEventStream,
  parseStreamingJson,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StreamOptions,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";

import type { JsonRecord } from "./types.ts";
import { asRecord, readResponseText, toNonNegativeNumber } from "./util.ts";

export const OLLAMA_SHOW_CONCURRENCY = 4;
const OLLAMA_MAX_ERROR_BODY_CHARS = 4000;

/** pi thinking levels mapped onto the effort strings Ollama's `think` accepts. */
export const OLLAMA_THINKING_LEVELS = ["low", "medium", "high", "max"];

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  tool_call_id?: string;
}

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

/** Extract text blocks and base64 images from a pi message content array. */
function ollamaContentParts(content: UserMessage["content"] | ToolResultMessage["content"]) {
  const blocks = Array.isArray(content) ? content : [{ type: "text" as const, text: content }];
  const text: string[] = [];
  const images: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "image") images.push(block.data);
  }
  return { text: text.join("\n"), images };
}

function toOllamaMessages(context: Context): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const message of context.messages) {
    if (message.role === "user") {
      const { text, images } = ollamaContentParts(message.content);
      messages.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }
    if (message.role === "assistant") {
      const converted: OllamaChatMessage = { role: "assistant", content: "" };
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: NonNullable<OllamaChatMessage["tool_calls"]> = [];
      for (const block of message.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "thinking") thinkingParts.push(block.thinking);
        else if (block.type === "toolCall") {
          toolCalls.push({
            function: { name: block.name, arguments: block.arguments ?? {} },
          });
        }
      }
      converted.content = textParts.join("\n");
      const thinking = thinkingParts.join("\n");
      if (thinking) converted.thinking = thinking;
      if (toolCalls.length > 0) converted.tool_calls = toolCalls;
      messages.push(converted);
      continue;
    }
    // toolResult
    const { text, images } = ollamaContentParts(message.content);
    messages.push({
      role: "tool",
      content: text,
      tool_name: message.toolName,
      tool_call_id: message.toolCallId,
      ...(images.length > 0 ? { images } : {}),
    });
  }
  return messages;
}

/**
 * Map pi's reasoning option to Ollama's `think` field. `think` accepts a
 * boolean or an effort string ("low" | "medium" | "high" | "max"). When a
 * thinkingLevelMap exists the mapped value is sent; otherwise `true` enables
 * thinking and `false` (off, or a non-thinking model) disables it.
 */
function ollamaThink(
  model: Model<Api>,
  options?: SimpleStreamOptions,
): boolean | string | undefined {
  // Non-thinking models never receive the field.
  if (!model.reasoning) return undefined;
  // An unset reasoning option means pi's thinking is off; send false
  // explicitly so models whose default enables thinking stay quiet.
  if (!options?.reasoning) return false;
  const level = clampThinkingLevel(model, options.reasoning);
  if (level === "off") return false;
  const mapped = model.thinkingLevelMap?.[level];
  if (typeof mapped === "string") return mapped;
  return true;
}

function buildOllamaPayload(
  model: Model<Api>,
  context: Context,
  options: StreamOptions,
  think: boolean | string | undefined,
): JsonRecord {
  const ollamaOptions: JsonRecord = {};
  if (typeof options.temperature === "number") ollamaOptions.temperature = options.temperature;
  if (typeof options.maxTokens === "number") ollamaOptions.num_predict = options.maxTokens;
  if (model.contextWindow > 0) ollamaOptions.num_ctx = model.contextWindow;
  for (const [key, value] of Object.entries(options.samplingParams ?? {})) {
    ollamaOptions[key] = value;
  }
  const payload: JsonRecord = {
    model: model.id,
    messages: toOllamaMessages(context),
    stream: true,
  };
  if (think !== undefined) payload.think = think;
  if (Object.keys(ollamaOptions).length > 0) payload.options = ollamaOptions;
  if (context.tools && context.tools.length > 0) {
    payload.tools = context.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  return payload;
}

function isOllamaToolCall(value: unknown): value is OllamaToolCall {
  const record = asRecord(value);
  return typeof asRecord(record?.function)?.name === "string";
}

function ollamaErrorMessage(payload: unknown, fallback: string) {
  const error = asRecord(payload)?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

/** Read an ndjson response body line by line, invoking `onLine` per JSON value. */
async function readNdjson(response: Response, onLine: (value: JsonRecord) => void) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return; // tolerate partial/garbage lines between valid chunks
    }
    const record = asRecord(value);
    if (record) onLine(record);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  flush(buffer);
}

function ollamaRetryDelayMs(response: Response | undefined, attempt: number, cap: number) {
  const header = response?.headers.get("retry-after");
  const parsed = header ? Number(header) : Number.NaN;
  const requested = Number.isFinite(parsed) ? parsed * 1000 : 0;
  const exponential = Math.min(cap, 500 * 2 ** attempt);
  return Math.min(cap, Math.max(requested, exponential));
}

/**
 * Stream a completion from Ollama's native chat API (`POST {baseUrl}/api/chat`).
 * The response is NDJSON: each line is a partial `message` chunk until a final
 * line with `done: true` carries `done_reason` and token counts.
 */
function streamOllamaChat(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions & { think?: boolean | string },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      let payload: unknown = buildOllamaPayload(model, context, options ?? {}, options?.think);
      const nextPayload = await options?.onPayload?.(payload, model);
      if (nextPayload !== undefined) payload = nextPayload;

      const headers: Record<string, string> = { "content-type": "application/json" };
      for (const [key, value] of Object.entries(model.headers ?? {})) headers[key] = value;
      for (const [key, value] of Object.entries(options?.headers ?? {})) {
        if (value === null) delete headers[key];
        else headers[key] = value;
      }
      if (
        options?.apiKey &&
        !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
      ) {
        headers.Authorization = `Bearer ${options.apiKey}`;
      }

      const fetchImpl = options?.fetch ?? fetch;
      const url = `${model.baseUrl.replace(/\/+$/, "")}/api/chat`;
      const maxRetries = options?.maxRetries ?? 0;
      const maxRetryDelayMs = options?.maxRetryDelayMs ?? 60_000;
      const signal =
        options?.timeoutMs !== undefined
          ? AbortSignal.any([
              options?.signal ?? new AbortController().signal,
              AbortSignal.timeout(options.timeoutMs),
            ])
          : (options?.signal ?? null);

      let response: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal,
          });
        } catch (error) {
          if (attempt < maxRetries && !options?.signal?.aborted) {
            await new Promise((resolvePromise) =>
              setTimeout(resolvePromise, Math.min(maxRetryDelayMs, 500 * 2 ** attempt)),
            );
            continue;
          }
          throw error;
        }
        const retriable = response.status === 429 || response.status >= 500;
        if (retriable && attempt < maxRetries && !options?.signal?.aborted) {
          const delay = ollamaRetryDelayMs(response, attempt, maxRetryDelayMs);
          await response.body?.cancel().catch(() => undefined);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
          continue;
        }
        break;
      }

      if (!response) throw new Error("Ollama request produced no response");
      await options?.onResponse?.(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        },
        model,
      );
      if (!response.ok) {
        const body = await readResponseText(response, OLLAMA_MAX_ERROR_BODY_CHARS).catch(() => "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
        throw new Error(
          `HTTP ${response.status}: ${ollamaErrorMessage(parsed, body || response.statusText)}`,
        );
      }

      stream.push({ type: "start", partial: output });

      let currentBlock: { type: "text" | "thinking"; index: number } | undefined;
      const closeBlock = () => {
        if (!currentBlock) return;
        const block = output.content[currentBlock.index];
        if (block?.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: currentBlock.index,
            content: block.text,
            partial: output,
          });
        } else if (block?.type === "thinking") {
          stream.push({
            type: "thinking_end",
            contentIndex: currentBlock.index,
            content: block.thinking,
            partial: output,
          });
        }
        currentBlock = undefined;
      };
      const pushDelta = (type: "text" | "thinking", delta: string) => {
        if (!delta) return;
        if (currentBlock?.type !== type) {
          closeBlock();
          output.content.push(
            type === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" },
          );
          currentBlock = { type, index: output.content.length - 1 };
          stream.push({
            type: type === "text" ? "text_start" : "thinking_start",
            contentIndex: currentBlock.index,
            partial: output,
          });
        }
        const block = output.content[currentBlock.index];
        if (block?.type === "text") block.text += delta;
        else if (block?.type === "thinking") block.thinking += delta;
        stream.push({
          type: type === "text" ? "text_delta" : "thinking_delta",
          contentIndex: currentBlock.index,
          delta,
          partial: output,
        });
      };

      let toolCallIndex = 0;
      const pushToolCall = (raw: OllamaToolCall) => {
        const name = raw.function?.name;
        if (!name) return;
        const args =
          asRecord(raw.function?.arguments) ??
          (typeof raw.function?.arguments === "string"
            ? (parseStreamingJson(raw.function.arguments) as Record<string, unknown>)
            : {});
        const toolCall: ToolCall = {
          type: "toolCall",
          // Ollama does not generate call ids; synthesize one for matching.
          id: `ollama_call_${toolCallIndex++}`,
          name,
          arguments: args,
        };
        closeBlock();
        output.content.push(toolCall);
        const contentIndex = output.content.length - 1;
        stream.push({ type: "toolcall_start", contentIndex, partial: output });
        stream.push({
          type: "toolcall_end",
          contentIndex,
          toolCall,
          partial: output,
        });
      };

      let sawDone = false;
      await readNdjson(response, (chunk) => {
        const message = asRecord(chunk.message);
        if (typeof message?.thinking === "string") pushDelta("thinking", message.thinking);
        if (typeof message?.content === "string") pushDelta("text", message.content);
        if (Array.isArray(message?.tool_calls)) {
          for (const rawCall of message.tool_calls) {
            if (isOllamaToolCall(rawCall)) pushToolCall(rawCall);
          }
        }
        if (chunk.done === true) {
          sawDone = true;
          const input = toNonNegativeNumber(chunk.prompt_eval_count) ?? 0;
          const cacheRead = toNonNegativeNumber(chunk.prompt_eval_cached_count) ?? 0;
          const outputTokens = toNonNegativeNumber(chunk.eval_count) ?? 0;
          output.usage.input = input;
          output.usage.output = outputTokens;
          output.usage.cacheRead = cacheRead;
          output.usage.cacheWrite = 0;
          output.usage.totalTokens = input + outputTokens + cacheRead;
          output.usage.cost = calculateCost(model, output.usage);
          const reason = typeof chunk.done_reason === "string" ? chunk.done_reason : "stop";
          output.rawStopReason = reason;
          output.stopReason =
            reason === "length"
              ? "length"
              : output.content.some((b) => b.type === "toolCall")
                ? "toolUse"
                : "stop";
        }
        const chunkError = chunk.error;
        if (typeof chunkError === "string" && chunkError.trim()) {
          throw new Error(chunkError);
        }
      });

      closeBlock();

      if (options?.signal?.aborted) throw new Error("Request was aborted");
      if (!sawDone || output.stopReason === "pending") {
        throw new Error("Ollama stream ended without a done event");
      }
      stream.push({
        type: "done",
        reason: output.stopReason as "stop" | "length" | "toolUse",
        message: output,
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

export const streamOllamaChatSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const base = buildBaseOptions(model, context, options, options?.apiKey);
  const transformed = transformMessages(context.messages, model);
  const think = ollamaThink(model, options);
  return streamOllamaChat(model, { ...context, messages: transformed }, { ...base, think });
};
