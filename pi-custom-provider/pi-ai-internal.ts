// ---------------------------------------------------------------------------
// Adapted internals from @earendil-works/pi-ai (`dist/api/simple-options.js`,
// `dist/api/transform-messages.js`, and `dist/utils/estimate.js`), aligned with 1.5.0.
//
// Pi's extension module mapping exposes selected public entrypoints,
// including transcript helpers, but the `api/*` submodules cannot be
// imported at extension runtime (static, dynamic, or `import.meta.resolve` all
// fail under the compiled pi binary). Keep this file aligned with upstream when
// bumping the pinned pi-ai version.
// ---------------------------------------------------------------------------

import type {
  Api,
  AssistantMessage,
  TranscriptContext,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  SystemMessage,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";

import { clampThinkingLevel, getSystemMessageText } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// utils/estimate.js
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;

function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function estimateTextAndImageContentChars(
  content: UserMessage["content"] | ToolResultMessage["content"],
): number {
  if (typeof content === "string") return content.length;
  let chars = 0;
  for (const block of content)
    chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
  return chars;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateTextAndImageContentTokens(
  content: UserMessage["content"] | ToolResultMessage["content"],
): number {
  return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
}

function estimateToolsTokens(tools: Pick<Tool, "name">[] | undefined): number {
  if (!tools || tools.length === 0) return 0;
  return estimateTextTokens(safeJsonStringify(tools));
}

function estimateMessageTokens(message: Message): number {
  let chars = 0;
  if (message.role === "system") {
    return (
      estimateTextTokens(getSystemMessageText(message)) +
      estimateToolsTokens(message.toolsAdded) +
      estimateToolsTokens(message.toolsRemoved)
    );
  }
  if (message.role === "user") return estimateTextAndImageContentTokens(message.content);
  if (message.role === "toolResult") return estimateTextAndImageContentTokens(message.content);
  for (const block of message.content) {
    if (block.type === "text") {
      chars += block.text.length;
    } else if (block.type === "thinking") {
      chars += block.thinking.length;
    } else {
      chars += block.name.length + safeJsonStringify(block.arguments).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function getLastAssistantUsageInfo(
  messages: Message[],
): { usage: Usage; index: number } | undefined {
  let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
  let usageInfo: { usage: Usage; index: number } | undefined;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "assistant") {
      const assistant = message;
      // A newer prefix message was inserted after this response (for example, a
      // compaction summary), so its usage cannot describe the current prefix.
      const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
      if (
        usageAppliesToPrefix &&
        assistant.stopReason !== "aborted" &&
        assistant.stopReason !== "error" &&
        calculateContextTokens(assistant.usage) > 0
      ) {
        usageInfo = { usage: assistant.usage, index: i };
      }
    }
    latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
  }
  return usageInfo;
}

export function estimateContextTokens(context: TranscriptContext | Message[]): {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
} {
  const messages: Message[] = Array.isArray(context) ? context : context.messages;
  const usageInfo = getLastAssistantUsageInfo(messages);
  if (usageInfo) {
    const usageTokens = calculateContextTokens(usageInfo.usage);
    let trailingTokens = 0;
    for (let i = usageInfo.index + 1; i < messages.length; i++) {
      trailingTokens += estimateMessageTokens(messages[i]);
    }
    return {
      tokens: usageTokens + trailingTokens,
      usageTokens,
      trailingTokens,
      lastUsageIndex: usageInfo.index,
    };
  }
  let tokens = 0;
  for (const message of messages) tokens += estimateMessageTokens(message);
  return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}

// ---------------------------------------------------------------------------
// api/simple-options.js
// ---------------------------------------------------------------------------

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

export function clampMaxTokensToContext(
  model: Model<Api>,
  context: TranscriptContext,
  maxTokens: number,
): number {
  if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
  const available =
    model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
  return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}

export function buildBaseOptions(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): StreamOptions {
  const level = clampThinkingLevel(model, options?.reasoning ?? "off");
  return {
    ...options,
    samplingParams: {
      ...model.samplingParams,
      ...model.samplingParamsByThinkingLevel?.[level],
      ...options?.samplingParams,
    },
    maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
  };
}

// ---------------------------------------------------------------------------
// api/transform-messages.js
// ---------------------------------------------------------------------------

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

function replaceImagesWithPlaceholder(
  content: (TextContent | ImageContent)[],
  placeholder: string,
): (TextContent | ImageContent)[] {
  const result: (TextContent | ImageContent)[] = [];
  let previousWasPlaceholder = false;
  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }
    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }
  return result;
}

function downgradeUnsupportedImages(messages: Message[], model: Model<Api>): Message[] {
  if (model.input.includes("image")) {
    return messages;
  }
  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
      };
    }
    if (msg.role === "toolResult") {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
      };
    }
    return msg;
  });
}

/**
 * Normalize tool call ID for cross-provider compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 */
export function transformMessages(
  messages: Message[],
  model: Model<Api>,
  normalizeToolCallId?: (id: string, model: Model<Api>, source: AssistantMessage) => string,
): Message[] {
  // Build a map of original tool call IDs to normalized IDs
  const toolCallIdMap = new Map<string, string>();
  // Normalize null/undefined content from untyped callers (custom tools, hand-built
  // histories, old session files) so downstream code can rely on the type contract.
  const normalizedMessages = messages.map((msg) =>
    msg.content == null ? ({ ...msg, content: [] } as typeof msg) : msg,
  );
  const imageAwareMessages = downgradeUnsupportedImages(normalizedMessages, model);
  // First pass: transform messages (unsupported image downgrade, thinking blocks, tool call ID normalization)
  const transformed = imageAwareMessages.map((msg) => {
    // System and user messages pass through unchanged
    if (msg.role === "system" || msg.role === "user") {
      return msg;
    }
    // Handle toolResult messages - normalize toolCallId if we have a mapping
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }
    // Assistant messages need transformation check
    if (msg.role === "assistant") {
      const assistantMsg = msg;
      const isSameModel =
        assistantMsg.provider === model.provider &&
        assistantMsg.api === model.api &&
        assistantMsg.model === model.id;
      const transformedContent = assistantMsg.content.flatMap(
        (block): (TextContent | ThinkingContent | ToolCall)[] => {
          if (block.type === "thinking") {
            // Redacted thinking is opaque encrypted content, only valid for the same model.
            // Drop it for cross-model to avoid API errors.
            if (block.redacted) {
              return isSameModel ? [block] : [];
            }
            // For same model: keep thinking blocks with signatures (needed for replay)
            // even if the thinking text is empty (OpenAI encrypted reasoning)
            if (isSameModel && block.thinkingSignature) return [block];
            // Skip empty thinking blocks, convert others to plain text
            if (!block.thinking || block.thinking.trim() === "") return [];
            if (isSameModel) return [block];
            return [
              {
                type: "text" as const,
                text: block.thinking,
              },
            ];
          }
          if (block.type === "text") {
            if (isSameModel) return [block];
            return [
              {
                type: "text" as const,
                text: block.text,
              },
            ];
          }
          if (block.type === "toolCall") {
            const toolCall = block;
            let normalizedToolCall = toolCall;
            if (!isSameModel && toolCall.thoughtSignature) {
              normalizedToolCall = { ...toolCall };
              delete normalizedToolCall.thoughtSignature;
            }
            if (!isSameModel && normalizeToolCallId) {
              const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
              if (normalizedId !== toolCall.id) {
                toolCallIdMap.set(toolCall.id, normalizedId);
                normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
              }
            }
            return [normalizedToolCall];
          }
          return [block];
        },
      );
      return {
        ...assistantMsg,
        content: transformedContent,
      };
    }
    return msg;
  });
  // Second pass: insert synthetic empty tool results for orphaned tool calls
  // This preserves thinking signatures and satisfies API requirements
  const result: Message[] = [];
  let pendingToolCalls: Extract<AssistantMessage["content"][number], { type: "toolCall" }>[] = [];
  let existingToolResultIds = new Set<string>();
  // System messages are transparent to tool-call accounting: one that lands between a tool
  // call and its results is held back and emitted after the results (synthetic ones
  // included), so it never causes a duplicate result for a call that is answered later.
  const heldSystemMessages: SystemMessage[] = [];
  const closePendingToolCalls = () => {
    if (pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        if (!existingToolResultIds.has(tc.id)) {
          result.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text", text: "No result provided" }],
            isError: true,
            timestamp: Date.now(),
          });
        }
      }
      pendingToolCalls = [];
      existingToolResultIds = new Set();
    }
    result.push(...heldSystemMessages);
    heldSystemMessages.length = 0;
  };
  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];
    if (msg.role === "assistant") {
      // If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
      closePendingToolCalls();
      // Skip errored/aborted assistant messages entirely.
      // These are incomplete turns that shouldn't be replayed:
      // - May have partial content (reasoning without message, incomplete tool calls)
      // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
      // - The model should retry from the last valid state
      const assistantMsg = msg;
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        continue;
      }
      // Track tool calls from this assistant message
      const toolCalls = assistantMsg.content.filter(
        (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
          block.type === "toolCall",
      );
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set();
      }
      result.push(msg);
    } else if (msg.role === "toolResult") {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
    } else if (msg.role === "system") {
      if (pendingToolCalls.length > 0) {
        heldSystemMessages.push(msg);
      } else {
        result.push(msg);
      }
    } else if (msg.role === "user") {
      // A new user turn interrupts tool flow - insert synthetic results for orphaned calls
      closePendingToolCalls();
      result.push(msg);
    } else {
      result.push(msg);
    }
  }
  // If the conversation ends with unresolved tool calls, synthesize results now.
  closePendingToolCalls();
  return result;
}
