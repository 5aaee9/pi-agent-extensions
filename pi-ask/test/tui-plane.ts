import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as pty from "node-pty";

import { createAskPlane, hostCli, record } from "./host-plane.ts";

export interface ProgramStatusRecord {
  state?: string;
  app?: string;
  kind?: string;
  message?: string;
  fields: Readonly<Record<string, string>>;
}

export function programStatusRecords(output: string): ProgramStatusRecord[] {
  return output
    .split("\x1b]7501;")
    .slice(1)
    .flatMap((chunk) => {
      const st = chunk.indexOf("\x1b\\");
      const bell = chunk.indexOf("\x07");
      const end = Math.min(st < 0 ? Infinity : st, bell < 0 ? Infinity : bell);
      if (!Number.isFinite(end)) return [];
      const fields: Record<string, string> = {};
      for (const pair of chunk.slice(0, end).split(":")) {
        const equals = pair.indexOf("=");
        if (equals >= 0) fields[pair.slice(0, equals)] = pair.slice(equals + 1);
      }
      return [
        {
          fields,
          state: fields.state,
          app: fields.app,
          kind: fields.kind,
          message:
            fields.msg === undefined
              ? undefined
              : Buffer.from(fields.msg, "base64").toString("utf8"),
        },
      ];
    });
}

/** Real interactive Pi process, including its terminal protocol and extension loader. */
export async function startAskTui(
  options: { legacy: boolean; statusEnabled: boolean },
  payload: unknown,
) {
  const plane = await createAskPlane([payload]);
  let child: pty.IPty | undefined;
  let output = "";
  let exited = false;
  let exitCode: number | undefined;
  let closed = false;
  const listeners = new Set<() => void>();
  const kill = (): void => {
    if (!child || exited) return;
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (record(error).code !== "ESRCH") throw error;
    }
  };
  const onProcessExit = (): void => {
    kill();
    rmSync(plane.root, { recursive: true, force: true });
  };
  process.once("exit", onProcessExit);
  try {
    await writeFile(
      join(plane.agentDir, "pi-ask.json"),
      JSON.stringify({ schemaVersion: 5, notifications: { enabled: false } }),
    );
    child = pty.spawn(
      process.execPath,
      [hostCli(options.legacy), ...plane.args, "Ask the questions"],
      {
        cwd: plane.root,
        name: "xterm-256color",
        cols: 100,
        rows: 35,
        env: {
          ...plane.env,
          PI_PROGRAM_STATUS: options.statusEnabled ? "1" : "0",
          TERM_PROGRAM: "",
          TMUX: undefined,
          STY: undefined,
        },
      },
    );
    const terminal = child;
    const dataSubscription = terminal.onData((data) => {
      output += data;
      for (const listener of listeners) listener();
    });
    let resolveExit = (): void => {};
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const exitSubscription = terminal.onExit((event) => {
      exited = true;
      exitCode = event.exitCode;
      resolveExit();
      for (const listener of listeners) listener();
    });
    return {
      plane,
      terminal,
      output: () => output,
      statuses: () => programStatusRecords(output),
      waitFor: (predicate: (text: string) => boolean, description: string): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            listeners.delete(check);
            reject(new Error(`Timed out waiting for ${description}:\n${output}`));
          }, 20_000);
          const check = (): void => {
            if (predicate(output)) {
              clearTimeout(timer);
              listeners.delete(check);
              resolve();
            } else if (exited) {
              clearTimeout(timer);
              listeners.delete(check);
              reject(new Error(`Pi exited ${String(exitCode)} before ${description}:\n${output}`));
            }
          };
          listeners.add(check);
          check();
        }),
      close: async (): Promise<void> => {
        if (closed) return;
        closed = true;
        kill();
        await exit;
        dataSubscription.dispose();
        exitSubscription.dispose();
        process.removeListener("exit", onProcessExit);
        await plane.close();
      },
    };
  } catch (error) {
    kill();
    process.removeListener("exit", onProcessExit);
    await plane.close();
    throw error;
  }
}
