import type { Context } from "@deepseek-ai/cordis";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import type {
  ContentBlock,
  FinishReason,
  LlmResolvedModelInfo,
  ReasoningEffortId,
} from "@deepseek-ai/dsh-llm";
import type { Session, SessionId } from "@deepseek-ai/dsh-session";
import { deadline } from "@deepseek-ai/dsh-timeout";

import { MAX_OUTPUT_TOKENS, SUGGESTION_INSTRUCTIONS, SUGGESTION_TIMEOUT_MS } from "./constants.ts";
import { suggestionFromBlocks } from "./history.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "prompt-suggestions": { kind: "prompt-suggestions" };
  }
}

/** The exact route one auxiliary suggestion request uses. */
export interface SuggestionRoute {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: ReasoningEffortId;
}

/** The LLM face the suggestion generator needs. */
export type SuggestionLlm = Pick<Context["llm"], "stream">;

/**
 * Pick the lowest useful reasoning effort the route advertises.
 *
 * "Low" is the requested behavior; adapters that only expose off/minimal (or
 * any single level) still get their cheapest available setting. An adapter
 * that advertises nothing keeps its own default.
 * @param info - resolved model metadata, when available.
 * @returns the selected effort, or undefined to leave the adapter default.
 */
export function pickLowestEffort(
  info: LlmResolvedModelInfo | undefined,
): ReasoningEffortId | undefined {
  const efforts = info?.reasoning?.efforts;
  if (efforts === undefined || efforts.length === 0) return undefined;
  for (const preferred of ["low", "off", "minimal", "none"] as const) {
    const found = efforts.find((effort) => effort.id === preferred);
    if (found !== undefined) return found.id;
  }
  return efforts[0]?.id;
}

/**
 * Resolve the current conversation route and its cheapest reasoning effort.
 *
 * The main request header is the source of truth: the suggestion uses the same
 * provider and model that just answered. Before the first request header there
 * is nothing to reuse, so generation stays off.
 * @param llm - the LLM service (or a compatible face in tests).
 * @param session - the session whose last request route is reused.
 * @param signal - cancellation for the metadata lookup.
 * @returns the route, or undefined when the session has no usable route.
 */
export async function resolveSuggestionRoute(
  llm: Pick<Context["llm"], "resolveModelInfo">,
  session: Session,
  signal: AbortSignal,
): Promise<SuggestionRoute | undefined> {
  const config = session.requestHeader()?.config;
  if (config === undefined || config.provider === "" || config.model === "") return undefined;
  signal.throwIfAborted();
  let info: LlmResolvedModelInfo | undefined;
  try {
    info = await llm.resolveModelInfo(config.provider, config.model, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // A catalog that cannot describe the route must not suppress a working
    // model; fall back to the adapter's own reasoning default.
  }
  signal.throwIfAborted();
  return {
    provider: config.provider,
    model: config.model,
    ...(info === undefined ? {} : { reasoningEffort: pickLowestEffort(info) }),
  };
}

function failureOf(reason: FinishReason): string {
  if (reason.kind === "error" || reason.kind === "aborted") return reason.failure.message;
  return `suggestion model finished with ${reason.kind}`;
}

/**
 * Run one bounded, tool-free auxiliary prediction request.
 *
 * The call is ephemeral: it appends no session event, inherits no tools, hooks,
 * connectors, environment access, or goal, and owns only this response stream.
 * @param llm - the LLM service (or a compatible face in tests).
 * @param route - provider/model and selected low reasoning effort.
 * @param prompt - the framed recent conversation.
 * @param sessionId - session identity stamped on the request for routing.
 * @param signal - cancellation from turn changes or plugin teardown.
 * @returns the normalized suggestion, or an empty string when the model
 *   produced no usable follow-up.
 * @throws when the stream fails, is aborted, exceeds the 30-second deadline, or
 *   finishes without a plain text stop.
 */
export async function generateSuggestion(
  llm: SuggestionLlm,
  route: SuggestionRoute,
  prompt: string,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<string> {
  const callDeadline = deadline(signal, SUGGESTION_TIMEOUT_MS, "PROMPT_SUGGESTIONS_TIMEOUT");
  try {
    callDeadline.signal.throwIfAborted();
    const assembler = new BlockAssembler();
    let finish: FinishReason | undefined;
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
      system: SUGGESTION_INSTRUCTIONS,
      messages: [
        createUserMessage({
          content: [{ type: "text", text: prompt }],
          source: { kind: "prompt-suggestions" },
        }),
      ],
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: callDeadline.signal,
      sessionId,
    })) {
      callDeadline.signal.throwIfAborted();
      assembler.push(chunk);
      if (chunk.type === "finish") {
        finish = chunk.reason;
        if (chunk.reason.kind !== "stop") throw new Error(failureOf(chunk.reason));
      }
    }
    callDeadline.signal.throwIfAborted();
    if (finish === undefined) throw new Error("suggestion model did not finish");
    const blocks: readonly ContentBlock[] = assembler.blocks();
    return suggestionFromBlocks(blocks);
  } finally {
    callDeadline[Symbol.dispose]();
  }
}
