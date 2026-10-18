import type { SuggestionEngine } from "./engine.ts";
import { MAX_REQUEST_BYTES, RPC_ENDPOINT } from "./constants.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serverResponse(rpcId: string, result: unknown): Response {
  return Response.json(
    { type: "server-response", rpcId, result },
    { headers: { "cache-control": "no-store" } },
  );
}

function failure(code: string, message: string): unknown {
  return { ok: false, error: { code, message, details: {} } };
}

/**
 * Serve one suggestion query on the authenticated Connection API.
 *
 * The request body is a standard Client envelope; the response is a standard
 * Server envelope so the browser's ordinary `connection.rpc.call` can be used
 * without a bundle dependency on the connection package.
 * @param engine - the Host suggestion state machine.
 * @param request - an already authenticated Fetch request.
 * @returns the JSON response envelope or a plain transport rejection.
 */
export async function handleSuggestionRequest(
  engine: SuggestionEngine,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    return new Response("request too large", { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  if (
    !isRecord(parsed) ||
    parsed["type"] !== "client-request" ||
    typeof parsed["rpcId"] !== "string" ||
    parsed["method"] !== RPC_ENDPOINT
  ) {
    return new Response("bad request", { status: 400 });
  }
  const rpcId = parsed["rpcId"];
  const payload = parsed["payload"];
  const sessionId =
    isRecord(payload) && typeof payload["sessionId"] === "string"
      ? payload["sessionId"]
      : undefined;
  if (sessionId === undefined || sessionId === "" || sessionId.length > 256) {
    return serverResponse(
      rpcId,
      failure("prompt-suggestions/bad-request", "sessionId must be a non-empty string"),
    );
  }
  try {
    const reply = await engine.request(sessionId, request.signal);
    return serverResponse(rpcId, { ok: true, value: reply });
  } catch (error) {
    return serverResponse(
      rpcId,
      failure("prompt-suggestions/failed", error instanceof Error ? error.message : String(error)),
    );
  }
}
