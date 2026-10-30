import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piCliPath = join(dirname(codingAgentEntry), "cli.js");

export interface RpcMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface Notification {
  readonly message: string;
  readonly type: string | undefined;
}

export interface RpcWorkspace {
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly sessionFile: string;
  readonly session: SessionManager;
}

export interface PiRpcHost {
  readonly messages: readonly RpcMessage[];
  command(command: Record<string, unknown>): Promise<RpcMessage>;
  prompt(message: string): Promise<void>;
  waitForSettled(count: number): Promise<void>;
  entries(): Promise<readonly SessionEntry[]>;
  notifications(): readonly Notification[];
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(line: string): RpcMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  try {
    const value: unknown = JSON.parse(trimmed);
    if (!isRecord(value) || typeof value["type"] !== "string") return undefined;
    return { ...value, type: value["type"] };
  } catch {
    return undefined;
  }
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return isRecord(value) && typeof value["type"] === "string" && typeof value["id"] === "string";
}

/** The real Pi process must not inherit a developer's provider credentials or agent home. */
function isolatedEnvironment(agentDir: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: agentDir,
    PATH: process.env["PATH"] ?? "",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
  };
  if (process.env["TMPDIR"] !== undefined) environment["TMPDIR"] = process.env["TMPDIR"];
  if (process.platform === "win32") {
    environment["APPDATA"] = agentDir;
    environment["LOCALAPPDATA"] = agentDir;
    environment["SystemRoot"] = process.env["SystemRoot"] ?? "";
  }
  return environment;
}

export async function createRpcWorkspace(): Promise<RpcWorkspace> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-continue-rpc-"));
  const sessionDir = join(agentDir, "sessions");
  const session = SessionManager.create(agentDir, sessionDir);
  const sessionFile = session.getSessionFile();
  if (sessionFile === undefined) throw new Error("Pi did not create a persisted session file");
  return { agentDir, sessionDir, sessionFile, session };
}

export async function removeRpcWorkspace(agentDir: string): Promise<void> {
  await rm(agentDir, { recursive: true, force: true });
}

export async function startPiRpc(options: {
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly sessionFile: string;
  readonly model: string;
}): Promise<PiRpcHost> {
  const messages: RpcMessage[] = [];
  let stderr = "";
  let closed = false;
  const child = spawn(
    process.execPath,
    [
      piCliPath,
      "--mode",
      "rpc",
      "--no-extensions",
      "--extension",
      extensionPath,
      "--session",
      options.sessionFile,
      "--session-dir",
      options.sessionDir,
      "--model",
      options.model,
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-builtin-tools",
      "--offline",
    ],
    {
      cwd: options.agentDir,
      env: isolatedEnvironment(options.agentDir),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const message = parseMessage(stdoutBuffer.slice(0, newline));
      if (message !== undefined) messages.push(message);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let exitError: Error | undefined;
  child.once("error", (error) => {
    exitError = error;
  });
  child.once("exit", (code, signal) => {
    exitError = new Error(
      `Pi RPC host exited (code ${String(code)}, signal ${String(signal)}): ${stderr.trim()}`,
    );
  });

  async function waitForMessage(
    predicate: (message: RpcMessage) => boolean,
    description: string,
    timeoutMs = 15_000,
  ): Promise<RpcMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = messages.find(predicate);
      if (found !== undefined) return found;
      if (exitError !== undefined) throw exitError;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${description} from the Pi RPC host: ${stderr.trim()}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  let nextCommandId = 0;
  async function command(payload: Record<string, unknown>): Promise<RpcMessage> {
    nextCommandId += 1;
    const id = String(nextCommandId);
    child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const response = await waitForMessage(
      (message) => message["type"] === "response" && message["id"] === id,
      `${String(payload["type"])} response`,
    );
    if (response["success"] !== true) {
      throw new Error(
        `Pi RPC command ${String(payload["type"])} failed: ${String(response["error"])}`,
      );
    }
    return response;
  }

  await command({ type: "get_state" });

  return {
    messages,
    command,
    async prompt(message: string): Promise<void> {
      await command({ type: "prompt", message });
    },
    async waitForSettled(count: number): Promise<void> {
      await waitForMessage(
        () => messages.filter((message) => message["type"] === "agent_settled").length >= count,
        `${String(count)} settled agent turn(s)`,
      );
    },
    async entries(): Promise<readonly SessionEntry[]> {
      const response = await command({ type: "get_entries" });
      const data = response["data"];
      if (!isRecord(data) || !Array.isArray(data["entries"])) {
        throw new Error("Pi RPC returned no session entries");
      }
      return data["entries"].filter(isSessionEntry);
    },
    notifications(): readonly Notification[] {
      return messages.flatMap((message) => {
        if (
          message["type"] !== "extension_ui_request" ||
          message["method"] !== "notify" ||
          typeof message["message"] !== "string"
        ) {
          return [];
        }
        const notifyType = message["notifyType"];
        return [
          {
            message: message["message"],
            type: typeof notifyType === "string" ? notifyType : undefined,
          },
        ];
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      child.stdin.end();
      const exited = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 3_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      if (!exited) child.kill("SIGKILL");
    },
  };
}

/** Custom message payloads observed in the host's `message_start` events. */
export function customMessages(
  messages: readonly RpcMessage[],
): readonly Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message["type"] !== "message_start") return [];
    const payload = message["message"];
    if (!isRecord(payload) || typeof payload["customType"] !== "string") return [];
    return [payload];
  });
}
