// A world for scenarios on one xAI entry.
import type { RpcClient } from "./pi.ts";
import type { Scenario } from "./scenario.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { MANUAL_COMPACTION } from "./pi-provider-sub2api-support.ts";

export const ENCRYPTED = "reasoning.encrypted_content";
export const CACHE_HEADER = "x-sub2api-grok-client-tool-cache";
export const LOW_TO_XHIGH = ["low", "medium", "high", "xhigh"].map((value) => ({ value }));

export const openWith = ({ rpc, world }: Scenario, ...args: readonly string[]): RpcClient =>
  rpc(["--session-dir", world.sessionDir, ...args]);

export async function xaiRelay(context: Scenario, inventory: readonly unknown[]): Promise<Relay> {
  const relay = await startRelay(context.server, { inventory: inventoryOf(inventory) });
  context.world.mergeSettings(MANUAL_COMPACTION);
  context.world.writeAgentFile("sub2api.json", {
    grok: { baseURL: relay.v1, token: "sk-grok", api: "xai" },
  });
  return relay;
}
