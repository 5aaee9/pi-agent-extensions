import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";

import {
  INPUT_PREFIX,
  MAX_HISTORY_TURNS,
  MAX_INPUT_BYTES,
  MAX_SUGGESTION_CHARS,
  SUGGESTION_INSTRUCTIONS,
} from "./constants.ts";

/** One recent user/assistant exchange, as it is framed for the model. */
export interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Extract the model-visible text of one message.
 *
 * Reasoning and tool payloads are never part of the prediction input: the user
 * sees only text, so tool arguments and private reasoning must not shape the
 * suggestion.
 * @param message - any derived conversation message.
 * @returns its text blocks joined by a newline, trimmed.
 */
export function messageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Select the most recent completed user/assistant exchanges.
 *
 * Only a direct human `user/message` starts a turn; synthetic context messages
 * and developer/tool messages are skipped. The last textual assistant message
 * before the next human input is the turn's visible answer, so intermediate
 * pre-tool text never becomes the exchange's assistant side.
 * @param messages - derived model-visible history.
 * @param maxTurns - maximum exchanges retained, oldest first.
 * @returns completed exchanges, oldest first.
 */
export function selectRecentTurns(
  messages: readonly Message[],
  maxTurns: number = MAX_HISTORY_TURNS,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      if (message.source.kind !== "user") continue;
      const user = messageText(message);
      if (user === "") {
        current = undefined;
        continue;
      }
      if (current !== undefined && current.assistant !== "") turns.push(current);
      current = { user, assistant: "" };
      continue;
    }
    if (message.role !== "assistant" || current === undefined) continue;
    const assistant = messageText(message);
    if (assistant !== "") current.assistant = assistant;
  }
  if (current !== undefined && current.assistant !== "") turns.push(current);
  return turns.slice(-maxTurns);
}

/** Clip text at a complete Unicode code point so its JSON fragment fits a byte budget. */
function clipJsonText(text: string, maxBytes: number): string {
  let used = 0;
  let out = "";
  for (const character of text) {
    const fragment = JSON.stringify(character).slice(1, -1);
    const bytes = Buffer.byteLength(fragment, "utf8");
    if (used + bytes > maxBytes) break;
    out += character;
    used += bytes;
  }
  return out;
}

/**
 * Frame the recent exchanges as a JSON payload under the actual wire budget.
 *
 * Oldest turns are dropped first; when one turn alone exceeds the budget, both
 * sides are clipped at code-point boundaries while preserving valid JSON.
 * @param turns - completed exchanges, oldest first.
 * @returns the user text for the auxiliary request, or an empty string when no
 *   usable payload fits.
 */
export function buildSuggestionPrompt(turns: readonly ConversationTurn[]): string {
  if (turns.length === 0) return "";
  const overhead = Buffer.byteLength(SUGGESTION_INSTRUCTIONS + INPUT_PREFIX, "utf8");
  const budget = MAX_INPUT_BYTES - overhead - 2;
  if (budget <= 0) return "";

  const selected = [...turns];
  let json = JSON.stringify(selected);
  while (selected.length > 1 && Buffer.byteLength(json, "utf8") > budget) {
    selected.shift();
    json = JSON.stringify(selected);
  }

  if (Buffer.byteLength(json, "utf8") > budget) {
    const only = selected[0];
    if (only === undefined) return "";
    const wrapper = Buffer.byteLength(JSON.stringify([{ user: "", assistant: "" }]), "utf8");
    let available = Math.max(0, budget - wrapper);
    while (available > 0) {
      const userBudget = Math.floor(available * 0.4);
      const clipped: ConversationTurn = {
        user: clipJsonText(only.user, userBudget),
        assistant: clipJsonText(only.assistant, available - userBudget),
      };
      json = JSON.stringify([clipped]);
      if (Buffer.byteLength(json, "utf8") <= budget) break;
      available -= Math.max(1, Math.floor(available / 10));
    }
    if (Buffer.byteLength(json, "utf8") > budget) return "";
  }

  const prompt = INPUT_PREFIX + json;
  if (
    Buffer.byteLength(SUGGESTION_INSTRUCTIONS, "utf8") + Buffer.byteLength(prompt, "utf8") >
    MAX_INPUT_BYTES
  ) {
    return "";
  }
  return prompt;
}

/**
 * Normalize one model reply into a displayable single-line suggestion.
 *
 * Fences, control and bidirectional characters, enclosing quotes and explicit
 * suggestion labels are removed. Empty, meta-text and single-character answers
 * are treated as "no suggestion" rather than shown.
 * @param raw - model text, possibly multiline.
 * @returns the normalized suggestion, or an empty string.
 */
export function normalizeSuggestion(raw: string): string {
  const lines = raw.replace(/\r\n?/gu, "\n").split("\n");
  let suggestion = "";
  for (const part of lines) {
    const cleaned = part
      .replace(/```[A-Za-z0-9_-]*/gu, "")
      .replace(/```/gu, "")
      .replace(/\p{Cc}/gu, " ")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu, "")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/^["'`“”‘’«»]+|["'`“”‘’«»]+$/gu, "")
      .trim();
    if (cleaned !== "") {
      suggestion = cleaned;
      break;
    }
  }
  if (suggestion === "") return "";
  suggestion = suggestion
    .replace(/^(?:suggestion|next message|下一句|建议)\s*[:：]\s*/iu, "")
    .trim();
  if (/^(?:no suggestion|none|n\/a|无建议|没有建议|无)$/iu.test(suggestion)) return "";
  if (/^(?:as an ai|i am an ai|我是人工智能)/iu.test(suggestion)) return "";
  suggestion = [...suggestion].slice(0, MAX_SUGGESTION_CHARS).join("").trim();
  return [...suggestion].length < 2 ? "" : suggestion;
}

/**
 * Assemble the terminal text blocks of one auxiliary response.
 *
 * Any tool call invalidates the response: the suggestion request is tool-free,
 * and executing a suggested task is explicitly out of scope. Reasoning blocks
 * are ignored.
 * @param blocks - assembled response blocks.
 * @returns the normalized suggestion, or an empty string.
 */
export function suggestionFromBlocks(blocks: readonly ContentBlock[]): string {
  if (blocks.some((block) => block.type === "tool-call")) return "";
  return normalizeSuggestion(
    blocks
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join(" "),
  );
}
