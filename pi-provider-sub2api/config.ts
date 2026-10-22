import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { parseServerTools, validateServerToolsForApi } from "./server-tools.ts";
import {
  CONFIG_FILENAME,
  CONFIGURED_APIS,
  DAYBREAK_MODES,
  SERVICE_TIER_MODES,
  XAI_API_SELECTOR,
} from "./types.ts";
import type {
  DaybreakMode,
  RelayConfig,
  RequestModes,
  ServiceTierMode,
  SupportedApi,
} from "./types.ts";
import { asRecord, base64Encode, hasControlCharacters, isSafeModelId } from "./util.ts";

// Do not attach the child-process error: it can contain the command and secrets.
export async function resolveCredentialCommand(value: string, signal?: AbortSignal) {
  let output: string;
  try {
    const result = await promisify(exec)(value.slice(1), {
      encoding: "utf8",
      timeout: 10_000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      signal,
    });
    output = result.stdout.trim();
  } catch {
    throw new Error(
      "Credential command failed (nonzero exit, timeout, cancellation, or output limit)",
    );
  }
  if (!output || hasControlCharacters(output)) {
    throw new Error(
      "Credential command must output a non-empty single-line value without control characters",
    );
  }
  return output;
}

export function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

export function getConfigPath() {
  return join(getAgentDir(), CONFIG_FILENAME);
}

export function createRelayAccountId(provider: string) {
  return `sub2api-${Buffer.from(provider, "utf8").toString("base64url")}`;
}

export function createCodexAuthToken(accountId: string) {
  return [
    base64Encode(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64Encode(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
        },
      }),
    ),
    "signature",
  ].join(".");
}

export function normalizeBaseUrls(value: string) {
  const configured = value.trim();
  // Errors never echo the value: a malformed URL can still carry credentials or keys.
  if (hasControlCharacters(value)) {
    throw new Error("baseURL must not include control characters");
  }
  if (configured.includes("?") || configured.includes("#")) {
    throw new Error("baseURL must not include a query or fragment");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("baseURL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseURL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("baseURL must not include credentials");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  const hasV1Suffix = pathname.endsWith("/v1");
  const createBaseUrl = (nextPathname: string) => {
    const url = new URL(parsed);
    url.pathname = nextPathname || "/";
    return url.toString().replace(/\/$/, "");
  };

  return {
    baseUrl: createBaseUrl(hasV1Suffix ? pathname : `${pathname}/v1`),
    // anthropicMessagesApi appends /v1/messages itself.
    anthropicBaseUrl: createBaseUrl(hasV1Suffix ? pathname.slice(0, -3) : pathname),
  };
}

function parseRequestModes(provider: string, field: string, value: unknown): RequestModes {
  const entry = asRecord(value);
  if (!entry) throw new Error(`provider ${provider} ${field} must be an object`);
  const { serviceTier, daybreak } = entry;
  if (serviceTier !== undefined && !SERVICE_TIER_MODES.includes(serviceTier as ServiceTierMode)) {
    throw new Error(
      `provider ${provider} ${field}.serviceTier must be ${SERVICE_TIER_MODES.join(", ")}`,
    );
  }
  if (daybreak !== undefined && !DAYBREAK_MODES.includes(daybreak as DaybreakMode)) {
    throw new Error(`provider ${provider} ${field}.daybreak must be ${DAYBREAK_MODES.join(", ")}`);
  }
  return {
    ...(serviceTier === undefined ? {} : { serviceTier: serviceTier as ServiceTierMode }),
    ...(daybreak === undefined ? {} : { daybreak: daybreak as DaybreakMode }),
  };
}

function parseModelRequestModes(provider: string, value: unknown) {
  const modes = new Map<string, RequestModes>();
  if (value === undefined) return modes;
  const entries = asRecord(value);
  if (!entries) throw new Error(`provider ${provider} modelRequestModes must be an object`);
  for (const [modelId, modelModes] of Object.entries(entries)) {
    if (!isSafeModelId(modelId)) {
      throw new Error(
        `provider ${provider} modelRequestModes has invalid model ID ${JSON.stringify(modelId)}`,
      );
    }
    modes.set(
      modelId,
      parseRequestModes(provider, `modelRequestModes[${JSON.stringify(modelId)}]`, modelModes),
    );
  }
  return modes;
}

const ENV_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

function resolveToken(provider: string, configured: string): string {
  if (configured.startsWith("$!")) return configured.slice(1);
  const match = ENV_REFERENCE_PATTERN.exec(configured);
  if (!match) return configured;
  const name = match[1]!;
  const resolved = process.env[name];
  if (resolved === undefined || !resolved.trim()) {
    throw new Error(
      `provider ${provider} token references environment variable ${JSON.stringify(name)} which is not set`,
    );
  }
  if (hasControlCharacters(resolved)) {
    throw new Error(
      `provider ${provider} token from environment variable ${JSON.stringify(name)} must not include control characters`,
    );
  }
  return resolved;
}

// xAI entries support neither native Codex compaction settings nor hosted tools.
function validateXaiEntry(
  provider: string,
  entry: { compress_service_tier?: unknown; compress_model?: unknown; serverTools?: unknown },
) {
  for (const field of ["compress_service_tier", "compress_model"] as const) {
    if (entry[field] !== undefined && entry[field] !== null) {
      throw new Error(
        `provider ${provider} ${field} is not supported with api xai; omit it or set it to null`,
      );
    }
  }
  const groups = asRecord(entry.serverTools);
  if (groups && Object.values(groups).some((tools) => Array.isArray(tools) && tools.length > 0)) {
    throw new Error(
      `provider ${provider} serverTools are not supported with api xai; hosted tools are outside this entry's contract`,
    );
  }
}

export function parseRelayConfig(provider: string, value: unknown): RelayConfig {
  if (
    !provider.trim() ||
    provider !== provider.trim() ||
    provider.length > 128 ||
    hasControlCharacters(provider)
  ) {
    throw new Error(`invalid provider name: ${JSON.stringify(provider)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider ${provider} must be an object`);
  }

  const entry = value as {
    baseURL?: unknown;
    token?: unknown;
    api?: unknown;
    compress_service_tier?: unknown;
    compress_model?: unknown;
    serverTools?: unknown;
    requestModes?: unknown;
    modelRequestModes?: unknown;
  };
  if (typeof entry.baseURL !== "string" || !entry.baseURL.trim()) {
    throw new Error(`provider ${provider} is missing baseURL`);
  }
  if (typeof entry.token !== "string" || !entry.token.trim()) {
    throw new Error(`provider ${provider} is missing token`);
  }
  if (hasControlCharacters(entry.token)) {
    throw new Error(`provider ${provider} token must not include control characters`);
  }
  if (
    entry.api !== undefined &&
    (typeof entry.api !== "string" ||
      !CONFIGURED_APIS.includes(entry.api as (typeof CONFIGURED_APIS)[number]))
  ) {
    throw new Error(
      `provider ${provider} has unsupported api ${JSON.stringify(entry.api)}; expected one of ${CONFIGURED_APIS.join(", ")}`,
    );
  }
  const xai = entry.api === XAI_API_SELECTOR;
  if (xai) validateXaiEntry(provider, entry);

  const compressServiceTier = entry.compress_service_tier;
  if (
    compressServiceTier !== undefined &&
    compressServiceTier !== null &&
    compressServiceTier !== "fast" &&
    compressServiceTier !== "ultrafast"
  ) {
    throw new Error(`provider ${provider} compress_service_tier must be fast, ultrafast, or null`);
  }

  const compressModel = entry.compress_model;
  if (compressModel !== undefined && compressModel !== null && !isSafeModelId(compressModel)) {
    throw new Error(`provider ${provider} compress_model must be a valid model ID or null`);
  }

  const configuredApi = xai ? "openai-responses" : (entry.api as SupportedApi | undefined);
  const serverTools = parseServerTools(provider, entry.serverTools);
  validateServerToolsForApi(provider, configuredApi, serverTools);
  const requestModes =
    entry.requestModes === undefined
      ? {}
      : parseRequestModes(provider, "requestModes", entry.requestModes);
  const modelRequestModes = parseModelRequestModes(provider, entry.modelRequestModes);

  const apiKey = resolveToken(provider, entry.token);
  let urls: ReturnType<typeof normalizeBaseUrls>;
  try {
    urls = normalizeBaseUrls(entry.baseURL);
  } catch (error) {
    throw new Error(
      `provider ${provider} ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const { baseUrl, anthropicBaseUrl } = urls;
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey,
    api: configuredApi,
    xai,
    compressServiceTier,
    compressModel,
    serverTools,
    requestModes,
    modelRequestModes,
    responsesUrl: `${baseUrl}/responses`,
    codexResponsesUrl: `${baseUrl}/codex/responses`,
    codexAuthToken: createCodexAuthToken(accountId),
  };
}

export async function loadRelayConfigs(configPath: string) {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("top-level value must be an object keyed by provider name");
  }
  const relays: RelayConfig[] = [];
  for (const [provider, value] of Object.entries(parsed)) {
    const relay = parseRelayConfig(provider, value);
    // Only configuration expressions execute; environment values and command
    // output are literal secrets, even when they begin with ! or contain $.
    const configuredToken = (value as { token: string }).token;
    if (configuredToken.startsWith("!")) {
      try {
        relay.apiKey = await resolveCredentialCommand(configuredToken);
      } catch (error) {
        throw new Error(
          `provider ${provider} token: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    relays.push(relay);
  }
  return relays;
}

export function escapeConfigLiteral(value: string) {
  const escapedDollars = value.replace(/\$/g, "$$$$");
  return escapedDollars.startsWith("!") ? `$!${escapedDollars.slice(1)}` : escapedDollars;
}
