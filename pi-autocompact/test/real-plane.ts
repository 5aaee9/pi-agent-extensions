import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type BoundaryContextPreview,
  type ExtensionUIContext,
  type SessionBoundaryDraft,
  type Theme,
} from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const themeModuleUrl = pathToFileURL(
  join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js"),
).href;
const themeModule = (await import(themeModuleUrl)) as {
  getThemeByName: (name: string) => Theme | undefined;
};

/** The host's UI seam: a mode supplies this context and Pi hands it to handlers.
 * Tests record what the extension reports instead of rendering an interactive UI. */
interface RecordingUi {
  readonly ui: ExtensionUIContext;
  readonly notifications: Array<{
    message: string;
    type: "info" | "warning" | "error" | undefined;
  }>;
  readonly statuses: Map<string, string | undefined>;
}

function recordingUi(): RecordingUi {
  const notifications: RecordingUi["notifications"] = [];
  const statuses = new Map<string, string | undefined>();
  const theme = themeModule.getThemeByName("dark");
  if (!theme) throw new Error("The pinned Pi installation has no built-in dark theme");
  const ui: ExtensionUIContext = {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: (message, type) => {
      notifications.push({ message, type });
    },
    onTerminalInput: () => () => undefined,
    setStatus: (key, text) => {
      statuses.set(key, text);
    },
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: async () => {
      throw new Error("This test's Pi mode does not provide custom UI components");
    },
    pasteToEditor: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  };
  return { ui, notifications, statuses };
}

/** A real OpenAI-compatible endpoint. The pinned provider streams to it with
 * its own HTTP client; nothing here replaces a host module or an injected stream. */
export interface ModelServer {
  readonly baseUrl: string;
  readonly requests: Array<{ readonly method: string | undefined; readonly body: string }>;
  failNextRequest: boolean;
  delayMs: number;
  readonly close: () => Promise<void>;
}

async function modelServer(): Promise<ModelServer> {
  let failNextRequest = false;
  let delayMs = 0;
  const requests: ModelServer["requests"] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      requests.push({ method: request.method, body });
      if (failNextRequest) {
        failNextRequest = false;
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: { message: "local model failure", type: "server_error" } }),
        );
        return;
      }
      setTimeout(() => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const chunk = (delta: object, finishReason: string | null = null): string =>
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "compact-model",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`;
        response.write(chunk({ role: "assistant", content: "local summary" }));
        response.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "compact-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      }, delayMs);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Model server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    get failNextRequest(): boolean {
      return failNextRequest;
    },
    set failNextRequest(value: boolean) {
      failNextRequest = value;
    },
    get delayMs(): number {
      return delayMs;
    },
    set delayMs(value: number) {
      delayMs = value;
    },
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

export interface RealSession {
  readonly session: AgentSession;
  readonly notifications: RecordingUi["notifications"];
  readonly statuses: RecordingUi["statuses"];
  command(args: string): Promise<void>;
  boundary(event: "turn_end" | "agent_before_settle"): Promise<SessionBoundaryDraft[]>;
}

export interface StartSessionOptions {
  readonly tokens?: number;
}

export interface RealPlane {
  readonly agentDir: string;
  readonly projectDir: string;
  readonly server: ModelServer;
  writeGlobalSettings(settings: unknown): Promise<void>;
  writeProjectSettings(settings: unknown): Promise<void>;
  readGlobalSettings(): Promise<string>;
  readProjectSettings(): Promise<string>;
  startSession(options?: StartSessionOptions): Promise<RealSession>;
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

function appendSize(session: AgentSession, tokens: number): void {
  session.sessionManager.appendMessage(userMessage("x".repeat(tokens * 4)));
}

/** Seed a conversation whose real context usage is exactly `tokens` and whose
 * projection has several entries, so the real compaction planner has a cut point. */
function seedUsage(session: AgentSession, tokens: number): void {
  const model = session.model;
  if (!model) throw new Error("The test session has no model");
  const first = Math.floor(tokens * 0.3);
  const second = Math.floor(tokens * 0.4);
  const third = tokens - first - second;
  appendSize(session, first);
  session.sessionManager.appendMessage(assistantMessage(model, first));
  appendSize(session, second);
  session.sessionManager.appendMessage(assistantMessage(model, first + second));
  appendSize(session, third);
}

function boundaryPreview(session: AgentSession): BoundaryContextPreview {
  const projection = session.sessionManager.buildSessionProjection();
  return {
    contextEntries: projection.entries,
    contextMessages: projection.messages,
    llmMessages: convertToLlm(projection.messages),
    pendingMessages: [],
    canContinue: true,
  };
}

export async function createRealPlane(): Promise<RealPlane> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-autocompact-agent-"));
  const projectDir = await mkdtemp(join(tmpdir(), "pi-autocompact-project-"));
  const server = await modelServer();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";

  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          probe: {
            baseUrl: server.baseUrl,
            api: "openai-completions",
            apiKey: "probe-key",
            models: [
              {
                id: "compact-model",
                name: "Compact Model",
                contextWindow: 1_000_000,
                maxTokens: 4096,
              },
              { id: "other-model", name: "Other Model", contextWindow: 2_000_000, maxTokens: 4096 },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(agentDir, "settings.json"), "{}\n");

  const sessions: AgentSession[] = [];
  const writeSettings = async (directory: string, settings: unknown): Promise<void> => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  };

  return {
    agentDir,
    projectDir,
    server,
    writeGlobalSettings: (settings) => writeSettings(agentDir, settings),
    writeProjectSettings: (settings) => writeSettings(join(projectDir, ".pi"), settings),
    readGlobalSettings: () => readFile(join(agentDir, "settings.json"), "utf8"),
    readProjectSettings: () => readFile(join(projectDir, ".pi", "settings.json"), "utf8"),
    startSession: async (options = {}) => {
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
      const recorded = recordingUi();
      await session.bindExtensions({
        uiContext: recorded.ui,
        mode: "print",
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          newSession: async () => ({ cancelled: false }),
          fork: async () => ({ cancelled: false }),
          navigateTree: async () => ({ cancelled: false }),
          switchSession: async () => ({ cancelled: false }),
          reload: async () => undefined,
        },
      });
      if (options.tokens !== undefined && options.tokens > 0) seedUsage(session, options.tokens);
      return {
        session,
        notifications: recorded.notifications,
        statuses: recorded.statuses,
        command: async (args) => {
          await session.prompt(args.length === 0 ? "/autocompact" : `/autocompact ${args}`);
        },
        boundary: async (event) => {
          const activeModel = session.model;
          if (!activeModel) throw new Error("The test session has no model");
          const result = await session.extensionRunner.emitBoundary(
            event === "turn_end"
              ? {
                  type: "turn_end",
                  turnIndex: 0,
                  message: assistantMessage(activeModel, 0),
                  toolResults: [],
                  messageEntryId: session.sessionManager.getLeafId() ?? "",
                  toolResultEntryIds: [],
                  outcome: "completed",
                }
              : { type: "agent_before_settle", outcome: "completed" },
            () => boundaryPreview(session),
          );
          return result.entries;
        },
      };
    },
    close: async () => {
      for (const session of sessions) session.dispose();
      await server.close();
      await rm(agentDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      if (previousOffline === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = previousOffline;
    },
  };
}
