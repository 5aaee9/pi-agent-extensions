import { MAX_MODEL_TOKEN_LIMIT, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from "./types.ts";
import type { JsonRecord } from "./types.ts";

export function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

export function hasControlCharacters(value: string) {
  return [...value].some(isControlCharacter);
}

export function sanitizeDisplayString(value: string, maxLength = 256) {
  return [...value]
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

export function toNonNegativeNumber(value: unknown) {
  const parsed =
    typeof value === "number" || (typeof value === "string" && value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function firstNonNegativeNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNonNegativeNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["enabled", "supported", "available", "value"]) {
    if (typeof record[key] === "boolean") return record[key];
  }
  if (typeof record.type === "string") {
    const type = record.type.toLowerCase();
    if (["disabled", "off", "none"].includes(type)) return false;
    if (["enabled", "adaptive", "budget"].includes(type)) return true;
  }
  return undefined;
}

export function mergeCompat(...values: (JsonRecord | undefined)[]) {
  const merged = Object.assign({}, ...values.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function readResponseText(response: Response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} bytes`);
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
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchJson(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  maxBytes = MAX_RESPONSE_BYTES,
  body?: string,
) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);
  const requestHeaders =
    body === undefined ? headers : { "content-type": "application/json", ...headers };
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: requestHeaders,
    body,
    redirect: "error",
    signal: requestSignal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return JSON.parse(await readResponseText(response, maxBytes)) as unknown;
}
