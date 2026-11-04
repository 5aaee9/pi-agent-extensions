// What must hold across packages: each registers what it promises once configured,
// and all of them together survive the session lifecycle in every mode.
import assert from "node:assert/strict";

import { isRecord } from "../../release/json.ts";
import { extensionCommands, modelKeys } from "./pi.ts";
import { REGISTRATIONS } from "./registrations.ts";
import { scenario } from "./scenario.ts";
import { isChatRequest } from "./servers.ts";
import { PROBE_ARGS, ROOT_DIR, readJsonRecord } from "./world.ts";
import { join } from "node:path";

const PRINT_EXIT_BOUND_MS = 20_000;

function piWorkspaces(): readonly string[] {
  const workspaces = readJsonRecord(join(ROOT_DIR, "package.json"))["workspaces"];
  const names = Array.isArray(workspaces) ? workspaces.map(String) : [];
  return names.filter((name) =>
    isRecord(readJsonRecord(join(ROOT_DIR, name, "package.json"))["pi"]),
  );
}

scenario("every Pi package has an expected registration", { packages: [] }, async () => {
  assert.deepEqual(
    piWorkspaces().filter((name) => !(name in REGISTRATIONS)),
    [],
    "add these packages to scripts/e2e/pi/registrations.ts",
  );
  await Promise.resolve();
});

for (const [name, registration] of Object.entries(REGISTRATIONS)) {
  scenario(
    `${name} registers what it promises through the real bin`,
    { packages: [name], offline: !registration.online },
    async (context) => {
      await registration.configure?.(context);
      const chat = await context.probeServer();
      if (registration.effect !== undefined) await registration.effect(context, chat);
      const client = context.rpc(["--no-session", ...PROBE_ARGS]);
      const commands = extensionCommands(await client.send({ type: "get_commands" }));
      for (const command of registration.commands) assert.ok(commands.includes(command), command);
      const models = modelKeys(await client.send({ type: "get_available_models" }));
      for (const model of registration.models) assert.ok(models.includes(model), model);
      assert.deepEqual(client.extensionErrors(), []);
    },
  );
}

const ALL_PACKAGES = Object.keys(REGISTRATIONS);

scenario(
  "all packages installed together finish print and JSON runs within the bound",
  { packages: ALL_PACKAGES },
  async ({ probeServer, print }) => {
    const server = await probeServer();
    const options = { timeoutMs: PRINT_EXIT_BOUND_MS };
    const printed = await print(["-p", "--no-session", ...PROBE_ARGS, "hello"], options);
    const asJson = await print(
      ["-p", "--mode", "json", "--no-session", ...PROBE_ARGS, "hello"],
      options,
    );
    for (const run of [printed, asJson]) {
      assert.equal(run.timedOut, false, `run did not exit within the bound\n${run.stderr}`);
      assert.equal(run.code, 0, run.stderr);
    }
    assert.equal(server.requests.filter(isChatRequest).length, 2);
  },
);

scenario(
  "all packages installed together survive a model change, a new session, and a fork",
  { packages: ALL_PACKAGES },
  async ({ probeServer, rpc, world }) => {
    await probeServer();
    const client = rpc(["--session-dir", world.sessionDir, ...PROBE_ARGS]);
    await client.prompt("first");
    const switched = await client.send({ type: "set_model", provider: "probe", modelId: "m" });
    assert.equal(switched["success"], true);
    await client.prompt("after a model change");
    assert.equal((await client.send({ type: "new_session" }))["success"], true);
    await client.prompt("after a new session");
    const forkable = await client.send({ type: "get_fork_messages" });
    const data = forkable["data"];
    const messages = isRecord(data) && Array.isArray(data["messages"]) ? data["messages"] : [];
    const first: unknown = messages[0];
    assert.ok(isRecord(first));
    const forked = await client.send({ type: "fork", entryId: first["entryId"] });
    assert.equal(forked["success"], true);
    await client.prompt("after a fork");
    assert.deepEqual(client.extensionErrors(), []);
    assert.equal(await client.close(), 0);
  },
);
