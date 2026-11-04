// One test's world: its installed packages, servers, and processes, all torn
// down on every exit path.
import { test } from "node:test";

import { runPi, startRpc } from "./pi.ts";
import type { RpcClient, RunOptions, RunResult } from "./pi.ts";
import { startTerminal } from "./pty.ts";
import type { Terminal, TerminalOptions } from "./pty.ts";
import { startChatServer, startServer } from "./servers.ts";
import type { ChatScript, Handler, LocalServer } from "./servers.ts";
import { createWorld, probeModels } from "./world.ts";
import type { ProbeModelOptions, World, WorldOptions } from "./world.ts";

const SCENARIO_TIMEOUT_MS = 180_000;

export interface Scenario {
  readonly world: World;
  readonly chatServer: (script?: ChatScript) => Promise<LocalServer>;
  readonly server: (handler: Handler, port?: number) => Promise<LocalServer>;
  /** A local chat server registered in `models.json` as the probe model. */
  readonly probeServer: (script?: ChatScript, options?: ProbeModelOptions) => Promise<LocalServer>;
  readonly print: (args: readonly string[], options?: RunOptions) => Promise<RunResult>;
  readonly rpc: (args: readonly string[], options?: RunOptions) => RpcClient;
  readonly terminal: (args: readonly string[], options?: TerminalOptions) => Terminal;
}

type Cleanup = () => Promise<unknown> | undefined;

function contextFor(world: World, defer: (cleanup: Cleanup) => void): Scenario {
  const chatServer = async (script?: ChatScript): Promise<LocalServer> => {
    const started = await startChatServer(script);
    defer(started.close);
    return started;
  };
  return {
    world,
    chatServer,
    async server(handler, port) {
      const started = await startServer(handler, port);
      defer(started.close);
      return started;
    },
    async probeServer(script, modelOptions) {
      const started = await chatServer(script);
      world.writeAgentFile("models.json", probeModels(`${started.baseUrl}/v1`, modelOptions));
      return started;
    },
    print: async (args, runOptions) => {
      const result = await runPi(world, args, runOptions);
      return result;
    },
    rpc(args, runOptions) {
      const client = startRpc(world, args, runOptions);
      defer(client.close);
      return client;
    },
    terminal(args, terminalOptions) {
      const terminal = startTerminal(world, args, terminalOptions);
      defer(terminal.kill);
      return terminal;
    },
  };
}

export function scenario(
  name: string,
  options: WorldOptions,
  body: (context: Scenario) => Promise<void>,
): void {
  void test(name, { timeout: SCENARIO_TIMEOUT_MS }, async () => {
    const world = createWorld(options);
    const cleanups: Cleanup[] = [];
    try {
      await body(
        contextFor(world, (cleanup) => {
          cleanups.push(cleanup);
        }),
      );
    } finally {
      await Promise.allSettled(
        cleanups.map(async (cleanup) => {
          await cleanup();
        }),
      );
      world.dispose();
    }
  });
}
