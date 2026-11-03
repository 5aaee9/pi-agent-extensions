import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type CompactionEntry,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

/** Marks a request Pi's summarizer sends: its system prompt opens with this text. */
const SUMMARIZER_MARKER = "context summarization assistant";

/** A real OpenAI-compatible endpoint. The pinned provider streams to it with
 * its own HTTP client; nothing here replaces a host module or an injected stream. */
export interface ModelServer {
  readonly baseUrl: string;
  readonly requests: Array<{
    readonly method: string | undefined;
    readonly body: string;
    readonly summary: boolean;
  }>;
  /** Requests Pi's summarizer sent (native compaction's). */
  summaryRequests(): number;
  /** Requests a session turn sent to the model. */
  turnRequests(): number;
  /** Fail the next summarizer request with a 500 the real provider surfaces. */
  failNextSummary: boolean;
  /** The prompt-token usage every reply reports, i.e. the context size Pi measures. */
  usageTokens: number;
  /** Hold every reply until the returned release is called. */
  hold(): () => void;
  /** Resolves once at least `count` requests have arrived. */
  waitForRequests(count: number): Promise<void>;
  readonly close: () => Promise<void>;
}

async function modelServer(): Promise<ModelServer> {
  let failNextSummary = false;
  let usageTokens = 10;
  let gate: Promise<void> | undefined;
  const arrivals: Array<{ count: number; resolve: () => void }> = [];
  const requests: ModelServer["requests"] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const summary = body.includes(SUMMARIZER_MARKER);
      requests.push({ method: request.method, body, summary });
      for (const waiter of arrivals.splice(0)) {
        if (requests.length >= waiter.count) waiter.resolve();
        else arrivals.push(waiter);
      }
      if (summary && failNextSummary) {
        failNextSummary = false;
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: { message: "local model failure", type: "server_error" } }),
        );
        return;
      }
      const reply = (): void => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const chunk = (delta: object, finishReason: string | null, usage?: object): string =>
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "compact-model",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
            ...(usage === undefined ? {} : { usage }),
          })}\n\n`;
        response.write(chunk({ role: "assistant", content: "local summary" }, null));
        response.write(
          chunk({}, "stop", {
            prompt_tokens: usageTokens,
            completion_tokens: 2,
            total_tokens: usageTokens + 2,
          }),
        );
        response.end("data: [DONE]\n\n");
      };
      if (gate === undefined) reply();
      else void gate.then(reply);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Model server did not bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    summaryRequests: () => requests.filter((entry) => entry.summary).length,
    turnRequests: () => requests.filter((entry) => !entry.summary).length,
    get failNextSummary(): boolean {
      return failNextSummary;
    },
    set failNextSummary(value: boolean) {
      failNextSummary = value;
    },
    get usageTokens(): number {
      return usageTokens;
    },
    set usageTokens(value: number) {
      usageTokens = value;
    },
    hold: () => {
      let release = (): void => undefined;
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = undefined;
          resolve();
        };
      });
      return release;
    },
    waitForRequests: (count) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            arrivals.push({ count, resolve });
          }),
    close: async () => {
      const closed = new Promise<void>((resolve) => {
        server.once("close", () => resolve());
      });
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

type Notifications = Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;

export interface RealSession {
  readonly session: AgentSession;
  readonly notifications: Notifications;
  readonly statuses: Map<string, string | undefined>;
  /** Run the extension's status command. */
  command(): Promise<void>;
  /** Run one real prompt through Pi's agent loop against the local model server;
   * the loop ends with Pi's real `agent_settled`. */
  turn(text?: string): Promise<void>;
  /** Pi's own reload: the old instance gets `session_shutdown`, a fresh one `session_start`. */
  reload(): Promise<void>;
  /** Compaction entries on the current branch. */
  compactions(): CompactionEntry[];
}

export interface RealPlane {
  readonly agentDir: string;
  readonly server: ModelServer;
  writeGlobalSettings(settings: unknown): Promise<void>;
  /** Start a session whose conversation is seeded with this many tokens, enough
   * for Pi's native compaction to find a cut point (0 seeds nothing). */
  startSession(tokens?: number): Promise<RealSession>;
  close(): Promise<void>;
}

function userMessage(text: string): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function assistantMessage(
  model: NonNullable<AgentSession["model"]>,
  usageTokens: number,
): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "assistant",
    content: [{ type: "text", text: "." }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: usageTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usageTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function seed(session: AgentSession, tokens: number): void {
  const model = session.model;
  if (!model) throw new Error("The test session has no model");
  let total = 0;
  for (const share of [0.3, 0.4, 0.3]) {
    const size = Math.floor(tokens * share);
    total += size;
    session.sessionManager.appendMessage(userMessage("x".repeat(size * 4)));
    session.sessionManager.appendMessage(assistantMessage(model, total));
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Resolve once `check` holds, polling the real session; fail after `timeoutMs`. */
export async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    await sleep(10);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function createRealPlane(): Promise<RealPlane> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const directories: string[] = [];
  let server: ModelServer | undefined;
  const sessions: AgentSession[] = [];

  // Every step undoes what it can even when an earlier one throws, so a failed
  // test never leaks the server, the temporary directories, or the environment.
  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const session of sessions.splice(0)) {
      try {
        // Pi's runtime emits session_shutdown before it disposes a session;
        // do the same so a pending idle timer is released, as in a real exit.
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        session.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await server?.close();
    } catch (error) {
      failures.push(error);
    }
    for (const directory of directories.splice(0)) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
    restoreEnv("PI_OFFLINE", previousOffline);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Closing the real Pi plane failed");
    }
  };

  try {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-idle-compression-agent-"));
    directories.push(agentDir);
    const projectDir = await mkdtemp(join(tmpdir(), "pi-idle-compression-project-"));
    directories.push(projectDir);
    const modelServerInstance = await modelServer();
    server = modelServerInstance;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_OFFLINE = "1";

    await writeFile(
      join(agentDir, "models.json"),
      `${JSON.stringify(
        {
          providers: {
            probe: {
              baseUrl: modelServerInstance.baseUrl,
              api: "openai-completions",
              apiKey: "probe-key",
              models: [
                {
                  id: "compact-model",
                  name: "Compact Model",
                  contextWindow: 1_000_000,
                  maxTokens: 4096,
                },
                {
                  id: "other-model",
                  name: "Other Model",
                  contextWindow: 1_000_000,
                  maxTokens: 4096,
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(agentDir, "settings.json"), "{}\n");

    return {
      agentDir,
      server: modelServerInstance,
      writeGlobalSettings: async (settings) => {
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
      },
      startSession: async (tokens = 100_000) => {
        const modelRuntime = await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: join(agentDir, "models.json"),
        });
        const model = modelRuntime.getModel("probe", "compact-model");
        if (!model) throw new Error("Model probe/compact-model is missing");
        const settingsManager = SettingsManager.create(projectDir, agentDir);
        const resourceLoader = new DefaultResourceLoader({
          cwd: projectDir,
          agentDir,
          settingsManager,
          additionalExtensionPaths: [extensionPath],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        });
        await resourceLoader.reload();
        const loaded = resourceLoader.getExtensions();
        if (loaded.errors.length > 0 || loaded.extensions.length !== 1) {
          throw new Error(
            `The real extension loader rejected the package: ${JSON.stringify(loaded.errors)}`,
          );
        }
        const { session } = await createAgentSession({
          cwd: projectDir,
          agentDir,
          model,
          modelRuntime,
          settingsManager,
          sessionManager: SessionManager.inMemory(projectDir),
          resourceLoader,
          noTools: "all",
        });
        sessions.push(session);

        // Pi's UI context is the client side of the host's UI port. Keep the
        // host's own context and record only what the extension reports through it.
        const notifications: Notifications = [];
        const statuses = new Map<string, string | undefined>();
        const uiContext: ExtensionUIContext = {
          ...session.extensionRunner.getUIContext(),
          notify: (message, type) => {
            notifications.push({ message, type });
          },
          setStatus: (key, text) => {
            statuses.set(key, text);
          },
        };
        await session.bindExtensions({
          uiContext,
          mode: "print",
          commandContextActions: {
            waitForIdle: () => session.waitForIdle(),
            newSession: async () => ({ cancelled: false }),
            fork: async () => ({ cancelled: false }),
            navigateTree: async () => ({ cancelled: false }),
            switchSession: async () => ({ cancelled: false }),
            reload: async () => {
              await session.reload();
            },
          },
        });
        if (tokens > 0) seed(session, tokens);
        modelServerInstance.usageTokens = tokens > 0 ? tokens : 10;
        const compactions = (): CompactionEntry[] =>
          session.sessionManager
            .getBranch()
            .filter((entry): entry is CompactionEntry => entry.type === "compaction");
        return {
          session,
          notifications,
          statuses,
          command: async () => {
            await session.prompt("/idle-compression");
          },
          turn: async (text = "next step") => {
            await session.prompt(text);
            await session.waitForIdle();
          },
          reload: () => session.reload(),
          compactions,
        };
      },
      close: cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Creating the real Pi plane failed");
    }
    throw error;
  }
}
