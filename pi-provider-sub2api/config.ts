import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { parseServerTools, validateServerToolsForApi } from "./server-tools.ts";
import { CONFIG_FILENAME, SUPPORTED_APIS } from "./types.ts";
import type { RelayConfig, SupportedApi } from "./types.ts";
import { base64Encode, hasControlCharacters } from "./util.ts";

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
  const description = JSON.stringify(value);
  if (hasControlCharacters(value)) {
    throw new Error(`baseURL must not include control characters: ${description}`);
  }
  if (configured.includes("?") || configured.includes("#")) {
    throw new Error(`baseURL must not include a query or fragment: ${description}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`invalid baseURL: ${description}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseURL must use http or https: ${description}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`baseURL must not include credentials: ${description}`);
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

const ENV_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

function resolveToken(provider: string, configured: string): string {
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
    serverTools?: unknown;
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
    (typeof entry.api !== "string" || !SUPPORTED_APIS.includes(entry.api as SupportedApi))
  ) {
    throw new Error(
      `provider ${provider} has unsupported api ${JSON.stringify(entry.api)}; expected one of ${SUPPORTED_APIS.join(", ")}`,
    );
  }

  const configuredApi = entry.api as SupportedApi | undefined;
  const serverTools = parseServerTools(provider, entry.serverTools);
  validateServerToolsForApi(provider, configuredApi, serverTools);

  const apiKey = resolveToken(provider, entry.token);
  const { baseUrl, anthropicBaseUrl } = normalizeBaseUrls(entry.baseURL);
  const accountId = createRelayAccountId(provider);
  return {
    provider,
    accountId,
    baseUrl,
    anthropicBaseUrl,
    apiKey,
    api: configuredApi,
    serverTools,
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
  return Object.entries(parsed).map(([provider, value]) => parseRelayConfig(provider, value));
}

export function escapeConfigLiteral(value: string) {
  const escapedDollars = value.replace(/\$/g, "$$$$");
  return escapedDollars.startsWith("!") ? `$!${escapedDollars.slice(1)}` : escapedDollars;
}
