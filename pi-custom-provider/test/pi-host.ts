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
