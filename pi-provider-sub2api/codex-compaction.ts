import { calculateCost, type Model, type Tool, type Usage } from "@earendil-works/pi-ai";
import {
  buildContextEntries,
  convertToLlm,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

// Pi's extension loader aliases the public pi-ai package root to its compat entrypoint.
// Resolve our pinned serializer runtime first, then import its private modules by absolute
// URL so Jiti cannot rewrite subpaths as `compat.js/api/*`.
const PI_AI_RUNTIME_ENTRY = import.meta.resolve("@earendil-works/pi-ai");
const [constrainedSampling, responsesShared] = await Promise.all([
  import(new URL("./api/constrained-sampling.js", PI_AI_RUNTIME_ENTRY).href) as Promise<
    typeof import("@earendil-works/pi-ai/api/constrained-sampling")
  >,
  import(new URL("./api/openai-responses-shared.js", PI_AI_RUNTIME_ENTRY).href) as Promise<
    typeof import("@earendil-works/pi-ai/api/openai-responses-shared")
  >,
]);
const { createGrammarToolInputProperties } = constrainedSampling;
const { convertResponsesMessages } = responsesShared;

const NATIVE_COMPACTION_KIND = "sub2api-codex-native-compaction";
const NATIVE_COMPACTION_VERSION = 1;
const NATIVE_COMPACTION_SUMMARY = "[OpenAI native compaction checkpoint]";
const COMPACTION_TIMEOUT_MS = 180_000;
const MAX_COMPACTION_RESPONSE_BYTES = 32 * 1024 * 1024;
const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
// OpenAI documents `compaction`; some Codex relays emit `compaction_summary`.
// Both are opaque replay items and must be persisted without normalization.
const COMPACTION_ITEM_TYPES = new Set(["compaction", "compaction_summary"]);

export interface CodexCompactionRelay {
  provider: string;
  responsesUrl: string;
  apiKey: string;
}

type JsonObject = Record<string, unknown>;
type ResponseItem = JsonObject;

export interface NativeCodexCompactionDetails {
  kind: typeof NATIVE_COMPACTION_KIND;
  version: typeof NATIVE_COMPACTION_VERSION;
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
    typeof value.id === "string" &&
    value.id.length > 0 &&
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

function parseCompactedWindow(value: unknown): ResponseItem[] | undefined {
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
  if (value.slice(0, -1).some((item) => !isCompactedUserMessage(item))) return undefined;
  return structuredClone(value) as ResponseItem[];
}

function parseNativeCompactionDetails(value: unknown): NativeCodexCompactionDetails | undefined {
  if (!isJsonObject(value)) return undefined;
  if (value.kind !== NATIVE_COMPACTION_KIND || value.version !== NATIVE_COMPACTION_VERSION) {
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
  const compactedWindow = parseCompactedWindow(value.compactedWindow);
  if (!compactedWindow) return undefined;
  return {
    kind: NATIVE_COMPACTION_KIND,
    version: NATIVE_COMPACTION_VERSION,
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

function serializeMessages(pi: ExtensionAPI, model: Model<any>, entries: readonly SessionEntry[]) {
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
  const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry));
  return structuredClone(
    convertResponsesMessages(
      model,
      {
        systemPrompt: "",
        messages: convertToLlm(messages),
        tools: activeTools,
      },
      CODEX_TOOL_CALL_PROVIDERS,
      {
        includeSystemPrompt: false,
        grammarToolInputProperties: createGrammarToolInputProperties(
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
        ...serializeMessages(pi, model, branch.slice(checkpoint.checkpoint.index + 1)),
      ],
    };
  }

  const leafId = branch.at(-1)?.id ?? null;
  return {
    input: serializeMessages(pi, model, buildContextEntries(branch, leafId)),
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

async function compactRemotely(params: {
  relay: CodexCompactionRelay;
  model: Model<any>;
  input: ResponseItem[];
  instructions: string;
  signal: AbortSignal;
}) {
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(COMPACTION_TIMEOUT_MS)]);
  const response = await fetch(`${normalizeUrl(params.relay.responsesUrl)}/compact`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.relay.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model.id,
      input: params.input,
      instructions: params.instructions,
    }),
    redirect: "error",
    signal,
  });
  const text = await readBoundedResponse(response);
  if (!response.ok) throw new Error(`compact endpoint returned HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("compact endpoint returned invalid JSON");
  }
  if (
    !isJsonObject(payload) ||
    payload.object !== "response.compaction" ||
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    !isNonNegativeNumber(payload.created_at) ||
    !isCompactionUsage(payload.usage)
  ) {
    throw new Error("compact endpoint returned an invalid response object");
  }
  const compactedWindow = parseCompactedWindow(payload.output);
  if (!compactedWindow) throw new Error("compact endpoint returned an invalid compacted window");

  return {
    compactedWindow,
    compactResponseId: payload.id,
    createdAt: normalizeCreatedAt(payload.created_at),
    usage: parseCompactionUsage(params.model, payload.usage),
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
  const expectedPrefix = serializeMessages(pi, model, prefixEntries);
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
      const built = buildCompactionInput(pi, model, relay, event.branchEntries as SessionEntry[]);
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
    return rewriteProviderPayload(pi, ctx, relay, event.payload);
  });
}
