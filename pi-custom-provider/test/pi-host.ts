import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
  type ExtensionUIContext,
  type LoadExtensionsResult,
  type ProviderConfig,
} from "@earendil-works/pi-coding-agent";

/**
 * Drives the extension through Pi's real host plane: the pinned
 * `DefaultResourceLoader` loads `index.ts` with Pi's own extension loader, the
 * registrations are read from the runtime queue the host flushes when it binds,
 * and `createAgentSession` mounts that same load result so session, model
 * registry, command context, and provider-header dispatch are the host's own.
 */
export const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const piCliPath = join(
  dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
  "cli.js",
);

export interface ProviderRegistration {
  readonly name: string;
  readonly config: ProviderConfig;
}

export interface ExtensionHost {
  readonly loader: DefaultResourceLoader;
  readonly loaded: LoadExtensionsResult;
  readonly registrations: readonly ProviderRegistration[];
  readonly commands: readonly string[];
}

export async function loadExtensionHost(cwd: string, agentDir: string): Promise<ExtensionHost> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [extensionPath],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  const failure = loaded.errors[0];
  if (failure) throw new Error(`extension failed to load: ${failure.error}`);
  if (loaded.extensions.length !== 1) {
    throw new Error(`expected one loaded extension, got ${loaded.extensions.length}`);
  }
  const extension = loaded.extensions[0];
  if (!extension) throw new Error(`extension was not loaded from ${extensionPath}`);
  return {
    loader,
    loaded,
    registrations: loaded.runtime.pendingProviderRegistrations.map(({ name, config }) => ({
      name,
      config,
    })),
    commands: [...extension.commands.keys()],
  };
}

export async function startHostSession(
  host: ExtensionHost,
  cwd: string,
  agentDir: string,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: host.loader,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "all",
  });
  return session;
}

export interface RecordedNotification {
  readonly message: string;
  readonly type: "info" | "warning" | "error" | undefined;
}

/**
 * Pi's UI context is the client side of the host's UI port (interactive mode
 * implements it on the terminal, RPC mode over its protocol). Keep the host's
 * own context and record only the notify calls the runner delivers through it.
 *
 * Boundary: this swaps exactly one member of the UI port, `notify`, which is
 * the seam a terminal or RPC client would otherwise render. Every other UI
 * member, the runner, the session, and the command context stay Pi's own.
 */
export function recordNotifications(session: AgentSession): RecordedNotification[] {
  const runner = session.extensionRunner;
  const notifications: RecordedNotification[] = [];
  const hostContext: ExtensionUIContext = {
    ...runner.getUIContext(),
    notify: (message, type) => {
      notifications.push({ message, type });
    },
  };
  runner.setUIContext(hostContext, "print");
  return notifications;
}

export interface PiProcessLoad {
  /** Names of the commands the real Pi process reports over RPC. */
  readonly commands: readonly string[];
  /** Everything the process wrote to stderr, which is where the extension's diagnostics go. */
  readonly stderr: string;
}

/**
 * Load the extension in the real `pi` binary (RPC mode, no other extensions)
 * and collect its stderr. The extension reports discovery problems through
 * `console.warn`, and Pi has no extension diagnostic surface for them, so the
 * real process stream is where those diagnostics are observed — nothing in
 * this process is patched to catch them.
 */
export async function loadInPiProcess(
  cwd: string,
  env: Readonly<Record<string, string>>,
  timeoutMs = 30_000,
): Promise<PiProcessLoad> {
  const child = spawn(process.execPath, [piCliPath, "-ne", "-e", extensionPath, "--mode", "rpc"], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`pi did not answer get_commands within ${String(timeoutMs)} ms:\n${stderr}`),
        );
      }, timeoutMs);
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        // Only complete lines are protocol messages; the last element may still be arriving.
        for (const line of stdout.split("\n").slice(0, -1)) {
          if (!line.includes('"id":"load"')) continue;
          clearTimeout(timer);
          resolve(JSON.parse(line));
          return;
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`pi exited with ${String(code)} before answering:\n${stderr}`));
      });
      child.stdin.write(`${JSON.stringify({ id: "load", type: "get_commands" })}\n`);
    });
    child.stdin.end();
    const code = await exited;
    if (code !== 0) throw new Error(`pi exited with ${String(code)}:\n${stderr}`);
    return { commands: commandNames(response), stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

function commandNames(response: unknown): string[] {
  if (typeof response !== "object" || response === null || !("data" in response)) return [];
  const { data } = response;
  if (typeof data !== "object" || data === null || !("commands" in data)) return [];
  const { commands } = data;
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((command: unknown) =>
    typeof command === "object" &&
    command !== null &&
    "name" in command &&
    typeof command.name === "string"
      ? [command.name]
      : [],
  );
}

/** Execute a registered command the way Pi's session does for a slash command. */
export async function runExtensionCommand(
  session: AgentSession,
  name: string,
  args = "",
): Promise<void> {
  const command = session.extensionRunner.getCommand(name);
  if (!command) throw new Error(`/${name} was not registered by the extension`);
  await command.handler(args, session.extensionRunner.createCommandContext());
}
