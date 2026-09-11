import {
  ANSI_ESCAPE,
  MAX_MODEL_TOKEN_LIMIT,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
} from "./types.ts";

export function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

export function hasControlCharacters(value: string) {
  return [...value].some(isControlCharacter);
}

export function sanitizeDisplayString(value: string, maxLength = 256) {
  return [...value.replace(ANSI_ESCAPE, "")]
    .filter((character) => !isControlCharacter(character))
    .join("")
    .trim()
    .slice(0, maxLength);
}

export function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !hasControlCharacters(value)
  );
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

export function isRetryableError(error: unknown) {
  if (error instanceof DOMException) {
    return ["AbortError", "NetworkError", "TimeoutError"].includes(error.name);
  }
  if (!(error instanceof Error)) return false;

  const cause = error.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code.toLowerCase() : "";
  const message = error.message.toLowerCase();
  return (
    ["eai_again", "econnrefused", "econnreset", "enotfound", "etimedout"].includes(code) ||
    ["fetch failed", "socket hang up", "terminated", "timeout"].some((fragment) =>
      message.includes(fragment),
    )
  );
}

export function discardResponse(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}

export async function readResponseText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
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
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export type TextFetchResult =
  | { response: Response; text: string }
  | { response: Response; bodyError: unknown }
  | { response: Response };

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<TextFetchResult | null> {
  if (init.signal?.aborted) return null;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(url, { ...init, redirect: "error", signal });
    if (!response.ok) return { response };
    try {
      return { response, text: await readResponseText(response) };
    } catch (bodyError) {
      discardResponse(response);
      return { response, bodyError };
    }
  } catch {
    return null;
  }
}

export function toPositiveInteger(value: unknown) {
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_MODEL_TOKEN_LIMIT
    ? parsed
    : undefined;
}

export function firstPositiveInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = toPositiveInteger(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function firstMaxTokensWithinContext(
  contextWindow: number | undefined,
  ...values: (number | undefined)[]
) {
  return values.find(
    (value): value is number =>
      value !== undefined && (contextWindow === undefined || value <= contextWindow),
  );
}

export function toFiniteNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toNonNegativeNumber(value: unknown) {
  const parsed = toFiniteNumber(value);
  return parsed === undefined ? undefined : Math.max(0, parsed);
}

export function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNonNegativeNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function firstStrictNonNegativeNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined && parsed >= 0) return parsed;
  }
  return undefined;
}

export function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const sanitized = sanitizeDisplayString(value);
    if (sanitized) return sanitized;
  }
  return undefined;
}
