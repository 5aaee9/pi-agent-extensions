import { calculateCost, type Model, type Tool, type Usage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

// Pi's extension loader aliases the public pi-ai package root to its compat entrypoint.
// Resolve our pinned serializer runtime first, then import its private modules by absolute
// URL so Jiti cannot rewrite subpaths as `compat.js/api/*`.
//
// OMP (oh-my-pi) aliases the same specifiers to a compat shim that neither exports
// `buildContextEntries` nor carries pi-ai's private module files, and Bun fails static
// named-import validation at module link time. Load everything optionally instead and
// skip native compaction when the host runtime cannot provide the serializers.
type ConstrainedSamplingModule = typeof import("@earendil-works/pi-ai/api/constrained-sampling");
type ResponsesSharedModule = typeof import("@earendil-works/pi-ai/api/openai-responses-shared");
type CodingAgentModule = typeof import("@earendil-works/pi-coding-agent");
type PrivateRuntime = {
  createGrammarToolInputProperties: ConstrainedSamplingModule["createGrammarToolInputProperties"];
  convertResponsesMessages: ResponsesSharedModule["convertResponsesMessages"];
  buildContextEntries: CodingAgentModule["buildContextEntries"];
  convertToLlm: CodingAgentModule["convertToLlm"];
  sessionEntryToContextMessages: CodingAgentModule["sessionEntryToContextMessages"];
};

async function loadPrivateRuntime(): Promise<PrivateRuntime | undefined> {
  try {
    const runtimeEntry = import.meta.resolve("@earendil-works/pi-ai");
    const [constrainedSampling, responsesShared, codingAgent] = await Promise.all([
      import(
        new URL("./api/constrained-sampling.js", runtimeEntry).href
      ) as Promise<ConstrainedSamplingModule>,
      import(
        new URL("./api/openai-responses-shared.js", runtimeEntry).href
      ) as Promise<ResponsesSharedModule>,
      import("@earendil-works/pi-coding-agent") as Promise<CodingAgentModule>,
    ]);
    const { createGrammarToolInputProperties } = constrainedSampling;
    const { convertResponsesMessages } = responsesShared;
    const { buildContextEntries, convertToLlm, sessionEntryToContextMessages } = codingAgent;
    if (
      typeof createGrammarToolInputProperties !== "function" ||
      typeof convertResponsesMessages !== "function" ||
      typeof buildContextEntries !== "function" ||
      typeof convertToLlm !== "function" ||
      typeof sessionEntryToContextMessages !== "function"
    ) {
      return undefined;
    }
    return {
      createGrammarToolInputProperties,
      convertResponsesMessages,
      buildContextEntries,
      convertToLlm,
      sessionEntryToContextMessages,
    };
  } catch {
    return undefined;
  }
}

const privateRuntime = await loadPrivateRuntime();

const NATIVE_COMPACTION_KIND = "sub2api-codex-native-compaction";
const LEGACY_NATIVE_COMPACTION_VERSION = 1;
const NATIVE_COMPACTION_VERSION = 2;
const NATIVE_COMPACTION_SUMMARY = "[OpenAI native compaction checkpoint]";
const COMPACTION_TIMEOUT_MS = 180_000;
const MAX_COMPACTION_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_RETAINED_COMPACTION_TOKENS = 64_000;
const MAX_RETAINED_COMPACTION_BYTES = 16 * 1024 * 1024;
const APPROXIMATE_CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_TOKENS = 1_200;
const UTF8_ENCODER = new TextEncoder();
const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
// OpenAI documents `compaction`; some Codex relays emit `compaction_summary`.
// Both are opaque replay items and must be persisted without normalization.
const COMPACTION_ITEM_TYPES = new Set(["compaction", "compaction_summary"]);
const RETAINED_COMPACTION_MESSAGE_ROLES = new Set(["user", "developer", "system"]);

export interface CodexCompactionRelay {
  provider: string;
  responsesUrl: string;
  apiKey: string;
}

type JsonObject = Record<string, unknown>;
type ResponseItem = JsonObject;
type NativeCodexCompactionVersion =
  | typeof LEGACY_NATIVE_COMPACTION_VERSION
  | typeof NATIVE_COMPACTION_VERSION;

export interface NativeCodexCompactionDetails {
  kind: typeof NATIVE_COMPACTION_KIND;
  version: NativeCodexCompactionVersion;
  provider: string;
  api: "openai-codex-responses";
  model: string;
  responsesUrl: string;
  compactedWindow: ResponseItem[];
  compactResponseId?: string;
  createdAt: string;
}

type NativeCheckpoint = {
  index: number;
  entry: Extract<SessionEntry, { type: "compaction" }>;
  details: NativeCodexCompactionDetails;
};

type NativeCheckpointResolution =
  | { status: "none" }
  | { status: "invalid"; reason: string }
  | { status: "valid"; checkpoint: NativeCheckpoint };

class NativeCheckpointError extends Error {}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function cloneItems(items: ResponseItem[]) {
  return structuredClone(items);
}

function isCompactionItem(value: unknown): value is ResponseItem {
  return (
    isJsonObject(value) &&
    typeof value.type === "string" &&
    COMPACTION_ITEM_TYPES.has(value.type) &&
    (value.id === undefined ||
      value.id === null ||
      (typeof value.id === "string" && value.id.length > 0)) &&
    typeof value.encrypted_content === "string" &&
    value.encrypted_content.length > 0
  );
}

function isCompactedMessageContent(value: unknown) {
  if (!isJsonObject(value) || typeof value.type !== "string") return false;
  if (value.type === "input_text") return typeof value.text === "string";
  if (value.type === "input_image") return typeof value.image_url === "string";
  return false;
}

function isCompactedUserMessage(value: unknown) {
  if (
    !isJsonObject(value) ||
    value.type !== "message" ||
    value.role !== "user" ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.status !== "completed"
  ) {
    return false;
  }
  return (
    typeof value.content === "string" ||
    (Array.isArray(value.content) && value.content.every(isCompactedMessageContent))
  );
}

function isRetainedV2Message(value: unknown) {
  if (
    !isJsonObject(value) ||
    (value.type !== undefined && value.type !== "message") ||
    typeof value.role !== "string" ||
    !RETAINED_COMPACTION_MESSAGE_ROLES.has(value.role)
  ) {
    return false;
  }
  return (
    typeof value.content === "string" ||
    (Array.isArray(value.content) && value.content.every(isCompactedMessageContent))
  );
}

function parseCompactedWindow(
  value: unknown,
  version: NativeCodexCompactionVersion,
): ResponseItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isJsonObject)) return undefined;
  const compactionIndexes = value.flatMap((item, index) =>
    isJsonObject(item) && typeof item.type === "string" && COMPACTION_ITEM_TYPES.has(item.type)
      ? [index]
      : [],
  );
  if (compactionIndexes.length !== 1 || compactionIndexes[0] !== value.length - 1) {
    return undefined;
  }
  if (!isCompactionItem(value.at(-1))) return undefined;
  const isRetainedMessage =
    version === LEGACY_NATIVE_COMPACTION_VERSION ? isCompactedUserMessage : isRetainedV2Message;
  if (value.slice(0, -1).some((item) => !isRetainedMessage(item))) return undefined;
  return structuredClone(value) as ResponseItem[];
}

function estimateRetainedMessageTokens(item: ResponseItem) {
  const content = item.content;
  if (typeof content === "string") return Math.ceil(content.length / APPROXIMATE_CHARS_PER_TOKEN);
  if (!Array.isArray(content)) return 0;
  return content.reduce((tokens, part) => {
    if (!isJsonObject(part)) return tokens;
    if (part.type === "input_text" && typeof part.text === "string") {
      return tokens + Math.ceil(part.text.length / APPROXIMATE_CHARS_PER_TOKEN);
    }
    return part.type === "input_image" ? tokens + ESTIMATED_IMAGE_TOKENS : tokens;
  }, 0);
}

function retainedMessageBytes(item: ResponseItem) {
  return UTF8_ENCODER.encode(JSON.stringify(item)).byteLength;
}

function selectRetainedV2Messages(input: ResponseItem[]) {
  let remainingTokens = MAX_RETAINED_COMPACTION_TOKENS;
  let remainingBytes = MAX_RETAINED_COMPACTION_BYTES;
  const retainedReversed: ResponseItem[] = [];
  const candidates = input.filter(isRetainedV2Message);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index]!;
    const tokens = estimateRetainedMessageTokens(item);
    const bytes = retainedMessageBytes(item);
    if (tokens > remainingTokens || bytes > remainingBytes) break;
    retainedReversed.push(item);
    remainingTokens -= tokens;
    remainingBytes -= bytes;
  }
  retainedReversed.reverse();
  return retainedReversed;
}

function buildV2CompactedWindow(input: ResponseItem[], compactionItem: ResponseItem) {
  return parseCompactedWindow(
    [...selectRetainedV2Messages(input), compactionItem],
    NATIVE_COMPACTION_VERSION,
  );
}

function parseNativeCompactionDetails(value: unknown): NativeCodexCompactionDetails | undefined {
  if (!isJsonObject(value)) return undefined;
  if (
    value.kind !== NATIVE_COMPACTION_KIND ||
    (value.version !== LEGACY_NATIVE_COMPACTION_VERSION &&
      value.version !== NATIVE_COMPACTION_VERSION)
  ) {
    return undefined;
  }
  if (
    typeof value.provider !== "string" ||
    value.api !== "openai-codex-responses" ||
    typeof value.model !== "string" ||
    typeof value.responsesUrl !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.compactResponseId !== undefined && typeof value.compactResponseId !== "string")
  ) {
    return undefined;
  }
  const compactedWindow = parseCompactedWindow(value.compactedWindow, value.version);
  if (!compactedWindow) return undefined;
  return {
    kind: NATIVE_COMPACTION_KIND,
    version: value.version,
    provider: value.provider,
    api: "openai-codex-responses",
    model: value.model,
    responsesUrl: normalizeUrl(value.responsesUrl),
    compactedWindow,
    compactResponseId: value.compactResponseId,
    createdAt: value.createdAt,
  };
}

function findLatestCompaction(branch: readonly SessionEntry[]) {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "compaction") return { index, entry };
  }
  return undefined;
}

function resolveNativeCheckpoint(
  branch: readonly SessionEntry[],
  relay: CodexCompactionRelay,
  model: Model<any>,
): NativeCheckpointResolution {
  const latest = findLatestCompaction(branch);
  if (!latest) return { status: "none" };

  const rawDetails = latest.entry.details;
  const claimsNativeState =
    latest.entry.summary === NATIVE_COMPACTION_SUMMARY ||
    (isJsonObject(rawDetails) && rawDetails.kind === NATIVE_COMPACTION_KIND);
  if (!claimsNativeState) return { status: "none" };

  const details = parseNativeCompactionDetails(rawDetails);
  if (!details) return { status: "invalid", reason: "checkpoint details are malformed" };
  if (
    details.provider !== relay.provider ||
    details.api !== model.api ||
    details.model !== model.id ||
    details.responsesUrl !== normalizeUrl(relay.responsesUrl)
  ) {
    return { status: "invalid", reason: "checkpoint belongs to a different model or relay" };
  }
  return {
    status: "valid",
    checkpoint: { index: latest.index, entry: latest.entry, details },
  };
}

function toTools(pi: ExtensionAPI): Tool[] {
  return pi.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function serializeMessages(
  rt: PrivateRuntime,
  pi: ExtensionAPI,
  model: Model<any>,
  entries: readonly SessionEntry[],
) {
  const allTools = toTools(pi);
  const activeNames = new Set(pi.getActiveTools());
  const activeTools = allTools.filter((tool) => activeNames.has(tool.name));
  const compat = model.compat as
    | {
        supportsOpenAIGrammarTools?: boolean;
        supportsStrictMode?: boolean;
        supportsToolSearch?: boolean;
      }
    | undefined;
  const supportsGrammarTools = compat?.supportsOpenAIGrammarTools ?? false;
  const messages = entries.flatMap((entry) => rt.sessionEntryToContextMessages(entry));
  return structuredClone(
    rt.convertResponsesMessages(
      model,
      {
        systemPrompt: "",
        messages: rt.convertToLlm(messages),
        tools: activeTools,
      },
      CODEX_TOOL_CALL_PROVIDERS,
      {
        includeSystemPrompt: false,
        grammarToolInputProperties: rt.createGrammarToolInputProperties(
          activeTools,
          supportsGrammarTools,
        ),
        deferredTools: compat?.supportsToolSearch
          ? new Map(allTools.map((tool) => [tool.name, tool]))
          : undefined,
        toolOptions: {
          strict: null,
          supportsStrictMode: compat?.supportsStrictMode ?? true,
          supportsOpenAIGrammarTools: supportsGrammarTools,
        },
      },
    ),
  ) as unknown as ResponseItem[];
}

function buildCompactionInput(
  rt: PrivateRuntime,
  pi: ExtensionAPI,
  model: Model<any>,
  relay: CodexCompactionRelay,
  branch: SessionEntry[],
) {
  const checkpoint = resolveNativeCheckpoint(branch, relay, model);
  if (checkpoint.status === "invalid") throw new NativeCheckpointError(checkpoint.reason);
  if (checkpoint.status === "valid") {
    return {
      input: [
        ...cloneItems(checkpoint.checkpoint.details.compactedWindow),
        ...serializeMessages(rt, pi, model, branch.slice(checkpoint.checkpoint.index + 1)),
      ],
    };
  }

  const leafId = branch.at(-1)?.id ?? null;
  return {
    input: serializeMessages(rt, pi, model, rt.buildContextEntries(branch, leafId)),
  };
}

async function readBoundedResponse(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPACTION_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`response exceeds ${MAX_COMPACTION_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_COMPACTION_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeds ${MAX_COMPACTION_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCompactionUsage(value: unknown) {
  if (!isJsonObject(value)) return false;
  const inputDetails = value.input_tokens_details;
  const outputDetails = value.output_tokens_details;
  return (
    isNonNegativeNumber(value.input_tokens) &&
    isJsonObject(inputDetails) &&
    isNonNegativeNumber(inputDetails.cached_tokens) &&
    (inputDetails.cache_write_tokens === undefined ||
      isNonNegativeNumber(inputDetails.cache_write_tokens)) &&
    isNonNegativeNumber(value.output_tokens) &&
    isJsonObject(outputDetails) &&
    isNonNegativeNumber(outputDetails.reasoning_tokens) &&
    isNonNegativeNumber(value.total_tokens)
  );
}

function parseCompactionUsage(model: Model<any>, value: unknown): Usage | undefined {
  if (!isJsonObject(value)) return undefined;
  const inputDetails = isJsonObject(value.input_tokens_details)
    ? value.input_tokens_details
    : undefined;
  const outputDetails = isJsonObject(value.output_tokens_details)
    ? value.output_tokens_details
    : undefined;
  const totalInput = parseNonNegativeNumber(value.input_tokens);
  const cacheRead = parseNonNegativeNumber(inputDetails?.cached_tokens);
  const cacheWrite = parseNonNegativeNumber(inputDetails?.cache_write_tokens);
  const output = parseNonNegativeNumber(value.output_tokens);
  const usage: Usage = {
    input: Math.max(0, totalInput - cacheRead - cacheWrite),
    output,
    cacheRead,
    cacheWrite,
    reasoning: parseNonNegativeNumber(outputDetails?.reasoning_tokens),
    totalTokens: parseNonNegativeNumber(value.total_tokens) || totalInput + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

function normalizeCreatedAt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 1_000_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? value.trim() : new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function parseSseEvents(text: string) {
  const events: JsonObject[] = [];
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("remote compaction stream returned invalid JSON");
    }
    if (!isJsonObject(event)) {
      throw new Error("remote compaction stream returned an invalid event");
    }
    events.push(event);
  };

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length);
    dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
  }
  flush();
  return events;
}

function remoteCompactionFailureMessage(event: JsonObject) {
  const response = isJsonObject(event.response) ? event.response : undefined;
  const error = response?.error ?? event.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isJsonObject(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof event.message === "string" && event.message.trim()) return event.message.trim();
  return "upstream response failed";
}

function parseRemoteCompactionStream(text: string) {
  let completedResponse: JsonObject | undefined;
  let outputItemCount = 0;
  const compactionItems: ResponseItem[] = [];

  for (const event of parseSseEvents(text)) {
    if (completedResponse) {
      throw new Error("remote compaction stream returned an event after response.completed");
    }
    if (event.type === "error" || event.type === "response.failed") {
      throw new Error(`remote compaction failed: ${remoteCompactionFailureMessage(event)}`);
    }
    if (event.type === "response.output_item.done") {
      outputItemCount += 1;
      if (isCompactionItem(event.item)) compactionItems.push(structuredClone(event.item));
      continue;
    }
    if (event.type === "response.completed") {
      if (completedResponse || !isJsonObject(event.response)) {
        throw new Error("remote compaction stream returned an invalid completed event");
      }
      completedResponse = event.response;
    }
  }

  if (!completedResponse) {
    throw new Error("remote compaction stream closed before response.completed");
  }
  if (compactionItems.length !== 1) {
    throw new Error(
      `remote compaction expected exactly one compaction output item, got ${compactionItems.length} from ${outputItemCount} output items`,
    );
  }
  if (typeof completedResponse.id !== "string" || completedResponse.id.length === 0) {
    throw new Error("remote compaction completed without a response id");
  }
  if (completedResponse.usage !== undefined && !isCompactionUsage(completedResponse.usage)) {
    throw new Error("remote compaction completed with invalid usage");
  }

  return {
    compactionItem: compactionItems[0]!,
    responseId: completedResponse.id,
    createdAt: normalizeCreatedAt(completedResponse.created_at),
    usage: completedResponse.usage,
  };
}

async function compactRemotely(params: {
  relay: CodexCompactionRelay;
  model: Model<any>;
  input: ResponseItem[];
  instructions: string;
  signal: AbortSignal;
}) {
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(COMPACTION_TIMEOUT_MS)]);
  const response = await fetch(normalizeUrl(params.relay.responsesUrl), {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${params.relay.apiKey}`,
      "Content-Type": "application/json",
      "x-codex-beta-features": "remote_compaction_v2",
    },
    body: JSON.stringify({
      model: params.model.id,
      input: [...params.input, { type: "compaction_trigger" }],
      instructions: params.instructions,
      stream: true,
      store: false,
    }),
    redirect: "error",
    signal,
  });
  const text = await readBoundedResponse(response);
  if (!response.ok) throw new Error(`remote compaction returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType && !contentType.includes("text/event-stream")) {
    throw new Error("remote compaction returned a non-SSE response");
  }

  const parsed = parseRemoteCompactionStream(text);
  const compactedWindow = buildV2CompactedWindow(params.input, parsed.compactionItem);
  if (!compactedWindow) throw new Error("remote compaction produced an invalid replay window");

  return {
    compactedWindow,
    compactResponseId: parsed.responseId,
    createdAt: parsed.createdAt,
    usage: parseCompactionUsage(params.model, parsed.usage),
  };
}

function appendCustomInstructions(systemPrompt: string, customInstructions?: string) {
  const instructions = customInstructions?.trim();
  return instructions
    ? `${systemPrompt}\n\nAdditional guidance for this compaction request:\n${instructions}`
    : systemPrompt;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      valuesEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => valuesEqual(left[key], right[key]))
    );
  }
  return false;
}

function findUniqueSequence(items: unknown[], sequence: unknown[]) {
  if (sequence.length === 0 || sequence.length > items.length) return undefined;
  let matchIndex: number | undefined;
  for (let index = 0; index <= items.length - sequence.length; index += 1) {
    if (!sequence.every((item, offset) => valuesEqual(item, items[index + offset]))) continue;
    if (matchIndex !== undefined) return undefined;
    matchIndex = index;
  }
  return matchIndex;
}

function rewriteProviderPayload(
  rt: PrivateRuntime,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  relay: CodexCompactionRelay,
  payload: unknown,
) {
  const model = ctx.model;
  if (!model || model.api !== "openai-codex-responses" || !isJsonObject(payload)) {
    return undefined;
  }
  if (payload.model !== model.id || !Array.isArray(payload.input)) return undefined;

  const branch = ctx.sessionManager.getBranch() as SessionEntry[];
  const checkpoint = resolveNativeCheckpoint(branch, relay, model);
  if (checkpoint.status !== "valid") return undefined;

  const { entry, index, details } = checkpoint.checkpoint;
  const firstKeptIndex = branch.findIndex(
    (candidate, candidateIndex) =>
      candidateIndex < index && candidate.id === entry.firstKeptEntryId,
  );
  if (firstKeptIndex < 0) return undefined;

  const prefixEntries = [entry, ...branch.slice(firstKeptIndex, index)];
  const expectedPrefix = serializeMessages(rt, pi, model, prefixEntries);
  const prefixIndex = findUniqueSequence(payload.input, expectedPrefix);
  if (prefixIndex === undefined) return undefined;
  const tailIndex = prefixIndex + expectedPrefix.length;

  const rewritten: JsonObject = {
    ...payload,
    input: [
      ...structuredClone(payload.input.slice(0, prefixIndex)),
      ...cloneItems(details.compactedWindow),
      ...structuredClone(payload.input.slice(tailIndex)),
    ],
  };
  delete rewritten.previous_response_id;
  delete rewritten.messages;
  return rewritten;
}

function supportedRelay(
  ctx: ExtensionContext,
  getRelay: (provider: string) => CodexCompactionRelay | undefined,
) {
  if (ctx.model?.api !== "openai-codex-responses") return undefined;
  return getRelay(ctx.model.provider);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function registerCodexCompaction(
  pi: ExtensionAPI,
  getRelay: (provider: string) => CodexCompactionRelay | undefined,
) {
  const rt = privateRuntime;
  // Hosts without pi's private serializer modules (OMP's compat shim) keep their own
  // compaction path; native Codex compaction is a pi-only enhancement.
  if (!rt) return;

  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx) => {
    const relay = supportedRelay(ctx, getRelay);
    const model = ctx.model;
    if (!relay || !model) return undefined;

    const priorCheckpoint = resolveNativeCheckpoint(
      event.branchEntries as SessionEntry[],
      relay,
      model,
    );
    if (priorCheckpoint.status === "invalid") {
      if (ctx.hasUI) {
        ctx.ui.notify(`Codex native compaction stopped: ${priorCheckpoint.reason}`, "error");
      }
      return { cancel: true };
    }
    const hasNativeCheckpoint = priorCheckpoint.status === "valid";
    try {
      const built = buildCompactionInput(
        rt,
        pi,
        model,
        relay,
        event.branchEntries as SessionEntry[],
      );
      const compacted = await compactRemotely({
        relay,
        model,
        input: built.input,
        instructions: appendCustomInstructions(ctx.getSystemPrompt(), event.customInstructions),
        signal: event.signal,
      });
      return {
        compaction: {
          summary: NATIVE_COMPACTION_SUMMARY,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          usage: compacted.usage,
          details: {
            kind: NATIVE_COMPACTION_KIND,
            version: NATIVE_COMPACTION_VERSION,
            provider: relay.provider,
            api: "openai-codex-responses",
            model: model.id,
            responsesUrl: normalizeUrl(relay.responsesUrl),
            compactedWindow: compacted.compactedWindow,
            compactResponseId: compacted.compactResponseId,
            createdAt: compacted.createdAt,
          } satisfies NativeCodexCompactionDetails,
        },
      };
    } catch (error) {
      if (event.signal.aborted || error instanceof NativeCheckpointError || hasNativeCheckpoint) {
        if (!event.signal.aborted && ctx.hasUI) {
          ctx.ui.notify(`Codex native compaction stopped: ${errorMessage(error)}`, "error");
        }
        return { cancel: true };
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Codex native compaction unavailable; using Pi compaction: ${errorMessage(error)}`,
          "warning",
        );
      }
      return undefined;
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    const relay = supportedRelay(ctx, getRelay);
    if (!relay) return undefined;
    return rewriteProviderPayload(rt, pi, ctx, relay, event.payload);
  });
}
