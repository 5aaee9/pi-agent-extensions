// Drives the published `pi` bin the way a caller does: print and JSON runs with
// stdin closed, and RPC as strict JSONL. Every process gets its own group so a
// hang is killed along with anything it spawned.
import { spawn } from "node:child_process";
import { once } from "node:events";

import { isRecord } from "../../release/json.ts";
import type { JsonRecord } from "../../release/json.ts";
import { piBin } from "./world.ts";
import type { EnvExtra, World } from "./world.ts";

const DEFAULT_RUN_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 15_000;

export function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error: unknown) {
    if (!(isRecord(error) && error["code"] === "ESRCH")) throw error;
  }
}

export interface RunResult {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly env?: EnvExtra;
}

function exitCode(values: readonly unknown[]): number | null {
  const [code] = values;
  return typeof code === "number" ? code : null;
}

export async function runPi(
  world: World,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const started = Date.now();
  const child = spawn(process.execPath, [piBin(), ...args], {
    cwd: world.cwd,
    env: world.env(options.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid);
  }, options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
  const closed: unknown[] = await once(child, "close");
  clearTimeout(timer);
  killGroup(child.pid);
  return {
    code: exitCode(closed),
    timedOut,
    stdout,
    stderr,
    durationMs: Date.now() - started,
  };
}

export type RpcEvent = JsonRecord;
export type RpcPredicate = (event: RpcEvent) => boolean;

export interface Notification {
  readonly message: string;
  readonly type: string;
}

export interface RpcClient {
  readonly events: readonly RpcEvent[];
  readonly stderr: () => string;
  /** Resolves with the next matching event from now on. */
  readonly next: (
    predicate: RpcPredicate,
    description: string,
    timeoutMs?: number,
  ) => Promise<RpcEvent>;
  /** Sends a command and resolves with its response, whatever its outcome. */
  readonly send: (
    command: Readonly<Record<string, unknown>>,
    timeoutMs?: number,
  ) => Promise<RpcEvent>;
  /** Sends a prompt and resolves once the session settles after it. */
  readonly prompt: (message: string, timeoutMs?: number) => Promise<void>;
  readonly notifications: () => readonly Notification[];
  readonly extensionErrors: () => readonly RpcEvent[];
  /** Ends stdin and resolves with the exit code, killing the group on a hang. */
  readonly close: () => Promise<number | null>;
}

interface Waiter {
  readonly predicate: RpcPredicate;
  readonly settle: (event: RpcEvent) => void;
}

function parseEvent(line: string): RpcEvent | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

interface EventLog {
  readonly events: readonly RpcEvent[];
  readonly accept: (line: string) => void;
  readonly next: RpcClient["next"];
}

function eventLog(stderr: () => string): EventLog {
  const events: RpcEvent[] = [];
  const waiters = new Set<Waiter>();
  return {
    events,
    accept(line) {
      const event = parseEvent(line);
      if (event === undefined) return;
      events.push(event);
      for (const waiter of waiters)
        if (waiter.predicate(event)) {
          waiters.delete(waiter);
          waiter.settle(event);
        }
    },
    async next(predicate, description, timeoutMs = DEFAULT_WAIT_MS) {
      const { promise, resolve, reject } = Promise.withResolvers<RpcEvent>();
      const waiter: Waiter = { predicate, settle: resolve };
      waiters.add(waiter);
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        const seen = events.map((event) => String(event["type"])).join(",");
        reject(
          new Error(`timed out waiting for ${description}\nevents: ${seen}\nstderr: ${stderr()}`),
        );
      }, timeoutMs);
      const event = await promise;
      clearTimeout(timer);
      return event;
    },
  };
}

function notificationsOf(events: readonly RpcEvent[]): readonly Notification[] {
  return events.flatMap((event) =>
    event["type"] === "extension_ui_request" && event["method"] === "notify"
      ? [{ message: String(event["message"]), type: String(event["notifyType"]) }]
      : [],
  );
}

function rpcCommands(
  log: EventLog,
  write: (line: string) => unknown,
): Pick<RpcClient, "send" | "prompt"> {
  let nextId = 0;
  const send: RpcClient["send"] = async (command, timeoutMs) => {
    nextId += 1;
    const id = String(nextId);
    const response = log.next(
      (event) => event["type"] === "response" && event["id"] === id,
      `response to ${String(command["type"])}`,
      timeoutMs,
    );
    write(`${JSON.stringify({ ...command, id })}\n`);
    const result = await response;
    return result;
  };
  return {
    send,
    async prompt(message, timeoutMs) {
      const settled = log.next(
        (event) => event["type"] === "agent_settled",
        `agent_settled after prompt ${JSON.stringify(message)}`,
        timeoutMs,
      );
      const response = await send({ type: "prompt", message }, timeoutMs);
      if (response["success"] !== true)
        throw new Error(`prompt failed: ${JSON.stringify(response)}`);
      await settled;
    },
  };
}

export function startRpc(
  world: World,
  args: readonly string[],
  options: RunOptions = {},
): RpcClient {
  const child = spawn(process.execPath, [piBin(), "--mode", "rpc", ...args], {
    cwd: world.cwd,
    env: world.env(options.env),
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const closed = once(child, "close");
  let stderr = "";
  let buffer = "";
  const log = eventLog(() => stderr);
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim() !== "") log.accept(line.trim());
  });
  const commands = rpcCommands(log, (line) => child.stdin.write(line));
  return {
    events: log.events,
    stderr: () => stderr,
    next: log.next,
    ...commands,
    notifications: () => notificationsOf(log.events),
    extensionErrors: () => log.events.filter((event) => event["type"] === "extension_error"),
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => {
        killGroup(child.pid);
      }, CLOSE_TIMEOUT_MS);
      const values: unknown[] = await closed;
      clearTimeout(timer);
      killGroup(child.pid);
      return exitCode(values);
    },
  };
}

function dataList(response: RpcEvent, key: string): readonly JsonRecord[] {
  const data = response["data"];
  const list = isRecord(data) ? data[key] : undefined;
  return Array.isArray(list) ? list.filter((item: unknown) => isRecord(item)) : [];
}

/** Names of the commands extensions registered, from a `get_commands` response. */
export function extensionCommands(response: RpcEvent): readonly string[] {
  return dataList(response, "commands")
    .filter((command) => command["source"] === "extension")
    .map((command) => String(command["name"]));
}

/** `provider/id` of each model, from a `get_available_models` response. */
export function modelKeys(response: RpcEvent): readonly string[] {
  return dataList(response, "models").map(
    (model) => `${String(model["provider"])}/${String(model["id"])}`,
  );
}

export function modelsOf(response: RpcEvent): readonly JsonRecord[] {
  return dataList(response, "models");
}
