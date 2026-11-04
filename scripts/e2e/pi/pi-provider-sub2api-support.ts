// What the `pi-provider-sub2api` scenarios share: driving commands and reloads over
// RPC, seeding the caches a previous run would leave, and reading what Pi persisted.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { modelsOf } from "./pi.ts";
import type { RpcClient, RpcEvent } from "./pi.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import type { World } from "./world.ts";

export const PACKAGE = { packages: ["pi-provider-sub2api"], offline: false };

export const CODEX = "openai-codex-responses";

export const OFFLINE_WORLD = { packages: ["pi-provider-sub2api"], offline: true };

/** Runs steps one after another, for scenarios where order is the point. */
export async function inSequence<Item, Result>(
  items: readonly Item[],
  step: (item: Item) => Promise<Result>,
): Promise<readonly Result[]> {
  const [first, ...rest] = items;
  if (first === undefined) return [];
  const result = await step(first);
  const others = await inSequence(rest, step);
  return [result, ...others];
}

const isNotice = (event: RpcEvent, expected: string): boolean =>
  event["type"] === "extension_ui_request" &&
  event["method"] === "notify" &&
  String(event["message"]).includes(expected);

/** Runs a slash command and resolves with the notification naming its outcome. */
export async function runCommand(
  client: RpcClient,
  command: string,
  expected: string,
): Promise<string> {
  const notice = client.next(
    (event) => isNotice(event, expected),
    `a notice with ${JSON.stringify(expected)} after ${command}`,
  );
  await client.send({ type: "prompt", message: command });
  const event = await notice;
  return String(event["message"]);
}

const RELOAD_NOTICE = "e2e reload done";

/**
 * RPC has no `/reload`, so scenarios load this next to the package: the same
 * `ctx.reload()` an installed user reaches through the terminal.
 */
export const RELOAD_EXTENSION = `
export default function (pi) {
  pi.registerCommand("e2e-reload", {
    description: "reload",
    handler: async (_args, ctx) => { await ctx.reload(); },
  });
  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") ctx.ui.notify(${JSON.stringify(RELOAD_NOTICE)}, "info");
  });
}
`;

export async function reload(client: RpcClient): Promise<void> {
  await runCommand(client, "/e2e-reload", RELOAD_NOTICE);
}

export const DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000;

export interface SeededRelay {
  readonly baseUrl: string;
  readonly api?: string;
  readonly xai?: boolean;
  /** Omits the timestamp when null, as entries older than timestamps had. */
  readonly ageMs?: number | null;
  readonly priceMultiplier?: number;
  readonly models: readonly unknown[];
}

/** Writes the package's discovery cache, as a previous run would have left it. */
export function seedDiscovery(world: World, relays: Readonly<Record<string, SeededRelay>>): void {
  const entries = Object.entries(relays).map(
    (pair: readonly [string, SeededRelay]): readonly [string, unknown] => {
      const [provider, relay] = pair;
      return [
        provider,
        {
          baseUrl: relay.baseUrl,
          ...(relay.api === undefined ? {} : { api: relay.api }),
          xai: relay.xai ?? false,
          ...(relay.ageMs === null ? {} : { fetchedAt: Date.now() - (relay.ageMs ?? 0) }),
          ...(relay.priceMultiplier === undefined
            ? {}
            : { priceMultiplier: relay.priceMultiplier }),
          models: relay.models,
        },
      ];
    },
  );
  world.writeAgentFile("sub2api-models.json", {
    version: 1,
    providers: Object.fromEntries(entries),
  });
}

/** Writes Pi's catalog cache: model lists by catalog provider. */
export function seedStore(
  world: World,
  sections: Readonly<Record<string, readonly unknown[]>>,
): void {
  const now = Date.now();
  world.writeAgentFile(
    "models-store.json",
    Object.fromEntries(
      Object.entries(sections).map((section: readonly [string, readonly unknown[]]) => [
        section[0],
        { checkedAt: now, lastModified: now, models: section[1] },
      ]),
    ),
  );
}

const parseJson = (text: string): unknown => {
  const parsed: unknown = JSON.parse(text);
  return parsed;
};

export const readDiscovery = (world: World): JsonRecord => {
  const parsed = parseJson(readFileSync(join(world.agentDir, "sub2api-models.json"), "utf8"));
  return isRecord(parsed) ? parsed : {};
};

/** One relay's entry in the discovery cache. */
export const discoveryEntry = (world: World, provider: string): JsonRecord => {
  const { providers } = readDiscovery(world);
  const entry = isRecord(providers) ? providers[provider] : undefined;
  return isRecord(entry) ? entry : {};
};

const POLL_MS = 50;
const POLL_LIMIT_MS = 30_000;

/** Waits for a state with no event of its own: a file write or a later registration. */
export async function until(
  check: () => Promise<boolean> | boolean,
  description: string,
  started = Date.now(),
): Promise<void> {
  if (await check()) return;
  if (Date.now() - started > POLL_LIMIT_MS) throw new Error(`timed out waiting for ${description}`);
  await delay(POLL_MS);
  await until(check, description, started);
}

export const findModel = (
  models: readonly JsonRecord[],
  provider: string,
  id: string,
): JsonRecord | undefined =>
  models.find((model) => model["provider"] === provider && model["id"] === id);

/** A model the scenario expects Pi to list, as it lists it now. */
export async function requireModel(
  client: RpcClient,
  provider: string,
  id: string,
): Promise<JsonRecord> {
  const model = await listedModel(client, provider, id);
  return model ?? assert.fail(`Pi does not list ${provider}/${id}`);
}

export const mustFindModel = (
  models: readonly JsonRecord[],
  provider: string,
  id: string,
): JsonRecord =>
  findModel(models, provider, id) ?? assert.fail(`Pi does not list ${provider}/${id}`);

/** One model as Pi lists it now. */
export async function listedModel(
  client: RpcClient,
  provider: string,
  id: string,
): Promise<JsonRecord | undefined> {
  const response = await client.send({ type: "get_available_models" });
  return findModel(modelsOf(response), provider, id);
}

export function sessionEntries(world: World): readonly JsonRecord[] {
  const files = readdirSync(world.sessionDir, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".jsonl"),
  );
  return files.flatMap((file) =>
    readFileSync(join(world.sessionDir, file), "utf8")
      .trim()
      .split("\n")
      .flatMap((line) => {
        const entry = parseJson(line);
        return isRecord(entry) ? [entry] : [];
      }),
  );
}

/** The session args every RPC scenario on a relay model uses. */
export const modelArgs = (world: World, provider: string, model: string): readonly string[] => [
  "--session-dir",
  world.sessionDir,
  "--provider",
  provider,
  "--model",
  model,
  "--approve",
];

/** The items a Responses request carries. */
export function inputOf(request: RecordedRequest | undefined): readonly JsonRecord[] {
  if (request === undefined) return [];
  const { input } = bodyOf(request);
  return Array.isArray(input) ? input.filter((item: unknown) => isRecord(item)) : [];
}

export const compactionEntries = (world: World): readonly JsonRecord[] =>
  sessionEntries(world).filter((entry) => entry["type"] === "compaction");

/** Settings that let any session compact on request and nothing compact or retry by itself. */
export const MANUAL_COMPACTION = {
  compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 16 },
  retry: { enabled: false },
};
