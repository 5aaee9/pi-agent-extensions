// A world for request-mode scenarios: a Responses relay and a Completions relay, with
// a credential command whose runs are counted and a real /reload.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../release/json.ts";
import type { RpcClient } from "./pi.ts";
import type { Scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import type { Relay } from "./servers-sub2api.ts";
import { RELOAD_EXTENSION, modelArgs } from "./pi-provider-sub2api-support.ts";

export const MODEL_A = "gpt-e2e-a";
export const MODEL_B = "gpt-e2e-b";
export const MODEL_C = "gpt-e2e-c";
export const MODEL_D = "gpt-e2e-d";
export const NON_OPENAI = "other-e2e";
export const COMPLETIONS_MODEL = "gpt-e2e-completions";
export const COMPLETIONS_TOKEN = "${E2E_COMPLETIONS_TOKEN}";

export interface ModesWorld {
  readonly relay: Relay;
  readonly completions: Relay;
  readonly configPath: string;
  readonly marker: string;
  readonly entry: (modes?: Readonly<Record<string, unknown>>) => unknown;
  readonly open: () => RpcClient;
}

export async function modesWorld(context: Scenario): Promise<ModesWorld> {
  const { rpc, server, world } = context;
  const inventory = inventoryOf(
    [MODEL_A, MODEL_B, MODEL_C, MODEL_D, NON_OPENAI].map((id) => ({ id })),
  );
  const relay = await startRelay(server, { inventory });
  const completions = await startRelay(server, {
    inventory: inventoryOf([{ id: COMPLETIONS_MODEL }]),
  });
  const marker = join(world.root, "credential-runs");
  const entry = (modes: Readonly<Record<string, unknown>> = {}): unknown => ({
    relay: {
      baseURL: relay.v1,
      token: `!printf x >> ${marker}; printf relay-token`,
      api: "openai-responses",
      futureSetting: "keep",
      ...modes,
    },
    completions: { baseURL: completions.v1, token: COMPLETIONS_TOKEN, api: "openai-completions" },
  });
  const fixture = world.writeAgentFile("e2e-reload.ts", RELOAD_EXTENSION);
  return {
    relay,
    completions,
    configPath: join(world.agentDir, "sub2api.json"),
    marker,
    entry,
    open: () =>
      rpc(["--extension", fixture, ...modelArgs(world, "relay", MODEL_A)], {
        env: { E2E_COMPLETIONS_TOKEN: "completions-token" },
      }),
  };
}

export interface Modes {
  readonly tier: unknown;
  readonly daybreak: unknown;
}

export async function wireModes(client: RpcClient, relay: Relay, model: string): Promise<Modes> {
  await client.send({ type: "set_model", provider: "relay", modelId: model });
  await client.prompt(`hello ${model}`);
  const body = bodyOf(relay.turns().at(-1) ?? assert.fail("no turn reached the relay"));
  assert.equal(body["model"], model);
  const programs = body["access_programs"];
  return {
    tier: body["service_tier"],
    daybreak: isRecord(programs) ? programs["cyber"] : undefined,
  };
}

export const savedConfig = ({ configPath }: ModesWorld): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  return isRecord(parsed) ? parsed : assert.fail("the configuration must stay an object");
};

export const savedRelay = (modes: ModesWorld): Readonly<Record<string, unknown>> => {
  const relay = savedConfig(modes)["relay"];
  return isRecord(relay) ? relay : assert.fail("the relay entry must stay an object");
};

export const credentialRuns = ({ marker }: ModesWorld): number =>
  existsSync(marker) ? readFileSync(marker, "utf8").length : 0;
