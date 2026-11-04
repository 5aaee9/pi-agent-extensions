// A world for native compaction scenarios on one Codex relay.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import type { RecordedRequest } from "./servers.ts";
import { manifestOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { CODEX, MANUAL_COMPACTION, inputOf, modelArgs } from "./pi-provider-sub2api-support.ts";

export const MARKER_SUMMARY = "[OpenAI native compaction checkpoint]";
export const COMMAND_MARKER = "sub2api-openai-compress";
export const COMPLETED = "OpenAI compaction completed";
export const LEVELS = ["low", "high"];
export const MANIFEST = manifestOf([
  { slug: "gpt-conv", supported_reasoning_levels: LEVELS },
  { slug: "gpt-other", supported_reasoning_levels: LEVELS },
]);

export type RelayEntry = Readonly<Record<string, unknown>>;

export async function codexRelay(context: Scenario, entry: RelayEntry = {}): Promise<Relay> {
  const relay = await startRelay(context.server, { manifest: MANIFEST });
  context.world.mergeSettings(MANUAL_COMPACTION);
  context.world.writeAgentFile("sub2api.json", {
    relay: { baseURL: relay.v1, token: "RELAY-TOKEN", api: CODEX, ...entry },
  });
  return relay;
}

export const openClient = ({ rpc, world }: Scenario): RpcClient =>
  rpc(modelArgs(world, "relay", "gpt-conv"));

export function typesIn(request: RecordedRequest | undefined, type: string): readonly JsonRecord[] {
  return inputOf(request).filter((item) => item["type"] === type);
}

export function detailsOf(entry: JsonRecord | undefined): JsonRecord {
  const details = entry?.["details"];
  if (!isRecord(details)) throw new Error(`no compaction details: ${JSON.stringify(entry)}`);
  return details;
}

export const windowOf = (entry: JsonRecord | undefined): readonly unknown[] => {
  const window = detailsOf(entry)["compactedWindow"];
  return Array.isArray(window) ? window : [];
};

export const modelOf = (request: RecordedRequest | undefined): unknown =>
  request === undefined ? undefined : bodyOf(request)["model"];

export const tierOf = (request: RecordedRequest | undefined): unknown =>
  request === undefined ? undefined : bodyOf(request)["service_tier"];

export async function compact(client: RpcClient): Promise<void> {
  const response = await client.send({ type: "compact" });
  assert.equal(response["success"], true, JSON.stringify(response));
}

export function fail(): never {
  throw new Error("expected a compaction request");
}
