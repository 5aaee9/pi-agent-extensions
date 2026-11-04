// Guarantees of the harness itself: it must not be able to report a pass from a
// shape users do not run.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { scenario } from "./scenario.ts";
import { assertNoNodeModulesAncestor, PROBE_ARGS } from "./world.ts";
import { isChatRequest } from "./servers.ts";

scenario(
  "an installed package has no host package beside it, and a turn reaches the local server",
  { packages: ["pi-skill"] },
  async ({ world, probeServer, rpc }) => {
    const server = await probeServer();
    const installed = join(world.agentDir, "npm", "node_modules");
    assert.ok(existsSync(join(installed, "@indexyz", "pi-skill", "package.json")));
    assert.ok(!existsSync(join(installed, "@earendil-works")));
    const client = rpc(["--no-session", ...PROBE_ARGS]);
    await client.prompt("hello");
    assert.equal(server.requests.filter(isChatRequest).length, 1);
    assert.deepEqual(client.extensionErrors(), []);
    assert.equal(await client.close(), 0);
  },
);

scenario(
  "the harness refuses a temporary root under a node_modules tree",
  { packages: [] },
  async () => {
    assert.throws(() => {
      assertNoNodeModulesAncestor("/tmp/node_modules/pi-e2e-x");
    }, /node_modules/u);
    await Promise.resolve();
  },
);
