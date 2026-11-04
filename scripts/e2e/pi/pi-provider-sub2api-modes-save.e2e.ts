// Saving request modes: what reaches the file, what a restart restores, and what is
// refused without writing.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { isRecord } from "../../release/json.ts";
import { scenario } from "./scenario.ts";
import { bodyOf } from "./servers.ts";
import { inventoryOf, startRelay } from "./servers-sub2api.ts";
import { PACKAGE, runCommand } from "./pi-provider-sub2api-support.ts";
import {
  COMPLETIONS_MODEL,
  COMPLETIONS_TOKEN,
  MODEL_A,
  MODEL_B,
  MODEL_C,
  MODEL_D,
  NON_OPENAI,
  credentialRuns,
  modesWorld,
  savedConfig,
  savedRelay,
  wireModes,
} from "./pi-provider-sub2api-modes-support.ts";

scenario(
  "saving the current model survives a restart without re-running the credential command",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile(
      "sub2api.json",
      modes.entry({
        requestModes: { daybreak: "standard" },
        modelRequestModes: { [MODEL_B]: { serviceTier: "ultrafast" } },
      }),
    );
    const client = modes.open();
    await client.send({ type: "get_state" });
    assert.equal(credentialRuns(modes), 1);
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    await runCommand(client, "/toggle-daybreak", "Daybreak Blue enabled");
    await client.send({ type: "set_model", provider: "relay", modelId: MODEL_C });
    await runCommand(client, "/toggle-ultrafast", "Ultrafast mode enabled");
    await client.send({ type: "set_model", provider: "relay", modelId: MODEL_A });
    const saved = await runCommand(client, "/sub2api-save", "Saved");
    assert.equal(saved, `Saved serviceTier fast, daybreak blue for relay/${MODEL_A}.`);
    assert.deepEqual(
      savedConfig(modes),
      modes.entry({
        requestModes: { daybreak: "standard" },
        modelRequestModes: {
          [MODEL_B]: { serviceTier: "ultrafast" },
          [MODEL_A]: { serviceTier: "fast", daybreak: "blue" },
        },
      }),
    );
    assert.equal(credentialRuns(modes), 1);
    await client.close();

    const restarted = modes.open();
    assert.deepEqual(await wireModes(restarted, modes.relay, MODEL_A), {
      tier: "priority",
      daybreak: "daybreak_blue",
    });
    assert.deepEqual(await wireModes(restarted, modes.relay, MODEL_C), {
      tier: undefined,
      daybreak: "standard",
    });
  },
);

scenario(
  "saving provider defaults keeps model entries in front and other models' temporary modes",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile(
      "sub2api.json",
      modes.entry({ modelRequestModes: { [MODEL_B]: { serviceTier: "default" } } }),
    );
    const client = modes.open();
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    await runCommand(client, "/toggle-daybreak", "Daybreak Blue enabled");
    await client.send({ type: "set_model", provider: "relay", modelId: MODEL_C });
    await runCommand(client, "/toggle-ultrafast", "Ultrafast mode enabled");
    await client.send({ type: "set_model", provider: "relay", modelId: MODEL_A });
    const saved = await runCommand(client, "/sub2api-save  provider ", "Saved");
    assert.equal(
      saved,
      "Saved serviceTier fast, daybreak blue as relay defaults; model-specific overrides still take precedence.",
    );
    assert.deepEqual(savedRelay(modes)["requestModes"], { serviceTier: "fast", daybreak: "blue" });
    assert.deepEqual(savedRelay(modes)["modelRequestModes"], {
      [MODEL_B]: { serviceTier: "default" },
    });
    assert.deepEqual(await wireModes(client, modes.relay, MODEL_B), {
      tier: "default",
      daybreak: "daybreak_blue",
    });
    const onC = await wireModes(client, modes.relay, MODEL_C);
    assert.equal(onC.tier, "ultrafast");
    const onD = await wireModes(client, modes.relay, MODEL_D);
    assert.equal(onD.tier, "priority");
  },
);

scenario(
  "provider defaults include the current model's saved override",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile(
      "sub2api.json",
      modes.entry({
        requestModes: { daybreak: "standard" },
        modelRequestModes: { [MODEL_A]: { serviceTier: "ultrafast" } },
      }),
    );
    const client = modes.open();
    await runCommand(client, "/sub2api-save provider", "Saved");
    assert.deepEqual(savedRelay(modes)["requestModes"], {
      serviceTier: "ultrafast",
      daybreak: "standard",
    });
    assert.deepEqual(savedRelay(modes)["modelRequestModes"], {
      [MODEL_A]: { serviceTier: "ultrafast" },
    });
    const onB = await wireModes(client, modes.relay, MODEL_B);
    assert.equal(onB.tier, "ultrafast");
  },
);

scenario(
  "saved off states override inherited modes after a restart, and an empty snapshot saves",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile(
      "sub2api.json",
      modes.entry({ requestModes: { serviceTier: "fast", daybreak: "blue" } }),
    );
    const client = modes.open();
    await runCommand(client, "/toggle-fast", "Fast mode disabled");
    await runCommand(client, "/toggle-daybreak", "Daybreak disabled");
    await runCommand(client, "/sub2api-save", "Saved");
    assert.deepEqual(savedRelay(modes)["modelRequestModes"], {
      [MODEL_A]: { serviceTier: "default", daybreak: "standard" },
    });
    await client.close();
    const restarted = modes.open();
    assert.deepEqual(await wireModes(restarted, modes.relay, MODEL_A), {
      tier: "default",
      daybreak: "standard",
    });
    await restarted.close();

    context.world.writeAgentFile("sub2api.json", modes.entry());
    const empty = modes.open();
    await empty.send({ type: "set_model", provider: "relay", modelId: MODEL_B });
    const saved = await runCommand(empty, "/sub2api-save", "Saved");
    assert.equal(saved, `Saved no modes for relay/${MODEL_B}.`);
    assert.deepEqual(savedRelay(modes)["modelRequestModes"], { [MODEL_B]: {} });
  },
);

scenario(
  "a Chat Completions model saves Responses-only modes without sending them",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    const config = modes.entry();
    context.world.writeAgentFile("sub2api.json", {
      ...(isRecord(config) ? config : {}),
      completions: {
        baseURL: modes.completions.v1,
        token: COMPLETIONS_TOKEN,
        api: "openai-completions",
        requestModes: { serviceTier: "ultrafast", daybreak: "blue" },
      },
    });
    const client = modes.open();
    await client.send({ type: "set_model", provider: "completions", modelId: COMPLETIONS_MODEL });
    await runCommand(client, "/sub2api-save", "Saved");
    await client.prompt("nothing active");
    const body = bodyOf(modes.completions.at("/v1/chat/completions").at(-1) ?? assert.fail());
    assert.equal(body["service_tier"], undefined);
    assert.equal(body["access_programs"], undefined);
    const saved = savedConfig(modes)["completions"];
    assert.ok(isRecord(saved));
    assert.deepEqual(saved["modelRequestModes"], {
      [COMPLETIONS_MODEL]: { serviceTier: "ultrafast", daybreak: "blue" },
    });
    assert.equal(saved["token"], COMPLETIONS_TOKEN);
  },
);

scenario("a rejected save writes nothing", PACKAGE, async (context) => {
  const modes = await modesWorld(context);
  const { world, probeServer } = context;
  await probeServer();
  world.writeAgentFile("sub2api.json", modes.entry());
  const before = readFileSync(modes.configPath, "utf8");
  const client = modes.open();
  await runCommand(client, "/sub2api-save model", "Usage: /sub2api-save");
  await runCommand(client, "/sub2api-save provider extra", "Usage: /sub2api-save");
  await client.send({ type: "set_model", provider: "relay", modelId: NON_OPENAI });
  await runCommand(client, "/sub2api-save", "requires a selected Sub2API OpenAI model");
  await client.send({ type: "set_model", provider: "probe", modelId: "m" });
  await runCommand(client, "/sub2api-save", "requires a selected Sub2API OpenAI model");
  await runCommand(client, "/toggle-fast", "Fast mode is not supported");
  assert.equal(readFileSync(modes.configPath, "utf8"), before);
  assert.equal(
    client.notifications().filter(({ type }) => type === "warning").length,
    5,
    JSON.stringify(client.notifications()),
  );
});

scenario(
  "with no model selected, a save and a toggle warn and write nothing",
  PACKAGE,
  async ({ rpc, server, world }) => {
    const relay = await startRelay(server, { inventory: inventoryOf([]) });
    const configPath = world.writeAgentFile("sub2api.json", {
      relay: { baseURL: relay.v1, token: "tok", api: "openai-responses" },
    });
    const before = readFileSync(configPath, "utf8");
    const client = rpc(["--session-dir", world.sessionDir]);
    await runCommand(client, "/sub2api-save", "requires a selected Sub2API OpenAI model");
    await runCommand(client, "/toggle-fast", "Fast mode is not supported");
    assert.equal(readFileSync(configPath, "utf8"), before);
  },
);

scenario(
  "a failed save reports the error and keeps the temporary mode",
  PACKAGE,
  async (context) => {
    const modes = await modesWorld(context);
    context.world.writeAgentFile("sub2api.json", modes.entry());
    const client = modes.open();
    await runCommand(client, "/toggle-fast", "Fast mode enabled");
    const config = modes.entry();
    const others = isRecord(config) ? { completions: config["completions"] } : {};
    writeFileSync(modes.configPath, JSON.stringify(others));
    const failed = await runCommand(client, "/sub2api-save", "Failed to save");
    assert.ok(failed.includes("provider relay is not an object"), failed);
    assert.deepEqual(savedConfig(modes), others);
    const during = await wireModes(client, modes.relay, MODEL_A);
    assert.equal(during.tier, "priority");
    context.world.writeAgentFile("sub2api.json", modes.entry());
    await runCommand(client, "/sub2api-save", "Saved");
    assert.deepEqual(savedRelay(modes)["modelRequestModes"], {
      [MODEL_A]: { serviceTier: "fast" },
    });
  },
);
