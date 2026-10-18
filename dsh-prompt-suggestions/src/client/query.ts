import type { ConnectionFace, SuggestionReply } from "./contracts.ts";
import { RPC_ENDPOINT } from "../shared.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate one untrusted wire reply.
 * @param value - `result.value` from the suggestion endpoint.
 * @returns the typed state; unknown shapes become `none`.
 */
export function parseSuggestionReply(value: unknown): SuggestionReply {
  if (!isRecord(value)) return { state: "none" };
  const state = value["state"];
  if (state === "ready" && typeof value["text"] === "string" && value["text"].trim() !== "") {
    return { state: "ready", text: value["text"] };
  }
  if (state === "pending") return { state: "pending" };
  if (state === "disabled") return { state: "disabled" };
  return { state: "none" };
}

/**
 * Ask the Host for the current session's suggestion.
 *
 * The standard Connection caller supplies authentication, correlation, and
 * abort handling; no bundle dependency on the connection package is needed.
 * @param connection - the client `connection` service.
 * @param sessionId - current session identity.
 * @param signal - aborts the wait when the composer changes or unmounts.
 * @returns the validated reply.
 * @throws on transport failure or a failed Remote result.
 */
export async function requestSuggestion(
  connection: ConnectionFace,
  sessionId: string,
  signal: AbortSignal,
): Promise<SuggestionReply> {
  const result = await connection.rpc.call("/api", RPC_ENDPOINT, { sessionId }, signal);
  if (!result.ok) throw new Error(result.error?.message ?? "suggestion request failed");
  return parseSuggestionReply(result.value);
}
