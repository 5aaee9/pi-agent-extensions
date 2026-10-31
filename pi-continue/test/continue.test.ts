import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  sessionEntryToContextMessages,
  type LoadExtensionsResult,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { findInterruptedTurn } from "../index.ts";
import {
  LOCAL_MODEL,
  LOCAL_PROVIDER,
  conversationOf,
  startModelServer,
  writeModelsJson,
  type ModelServer,
} from "./model-server.ts";
import {
  type PiRpcHost,
  type RpcMessage,
  createRpcWorkspace,
  customMessages,
  removeRpcWorkspace,
  startPiRpc,
} from "./pi-rpc.ts";

type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const LOCAL = `${LOCAL_PROVIDER}/${LOCAL_MODEL}`;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;

  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function userMessage(text = "Do the task"): SessionMessage {
  return {
    role: "user",
    content: text,
    timestamp: 1,
  };
}

function assistantMessage(
  stopReason: "stop" | "aborted" | "error",
  provider = "anthropic",
  model = "claude-sonnet",
): SessionMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "Partial work" }],
    api: "anthropic-messages",
    provider,
    model,
    usage,
    stopReason,
    ...(stopReason === "error" ? { errorMessage: "429: Provider returned error" } : {}),
    timestamp: 2,
  };
}

function appendAbortedTurn(
  session: SessionManager,
  provider = "anthropic",
  model = "claude-sonnet",
): void {
  session.appendMessage(userMessage());
  session.appendMessage(assistantMessage("aborted", provider, model));
}

/** Pi's public extension discovery, confined to an isolated agent directory. */
async function loadPiContinue(agentDir: string): Promise<LoadExtensionsResult> {
  const result = await discoverAndLoadExtensions([extensionPath], agentDir, agentDir);
  expect(result.errors).toEqual([]);
  expect(result.extensions).toHaveLength(1);
  return result;
}

function isUserMessage(entry: SessionEntry): boolean {
  return entry.type === "message" && entry.message.role === "user";
}

function retryMarkers(entries: readonly SessionEntry[]): readonly SessionEntry[] {
  return entries.filter(
    (entry) => entry.type === "custom_message" && entry.customType === "pi-continue:retry",
  );
}

/** The stop reason of the last assistant entry Pi persisted. */
function lastStopReason(entries: readonly SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type === "message" && entry.message.role === "assistant") {
      return entry.message.stopReason;
    }
  }
  return undefined;
}

/** What the original request looked like before it was interrupted. */
const ORIGINAL_REQUEST = [{ role: "user", content: "Do the task" }];

interface ScenarioOptions {
  /** `provider/id` to start Pi with; omitted, no model is selected. */
  readonly model?: string;
  /** Register the local model server in the agent's `models.json`. */
  readonly localModel?: boolean;
  readonly build: (session: SessionManager) => void;
  readonly drive: (host: PiRpcHost, server: ModelServer) => Promise<void>;
}

interface ScenarioResult {
  readonly messages: readonly RpcMessage[];
  readonly notifications: readonly {
    readonly message: string;
    readonly type: string | undefined;
  }[];
  readonly entries: readonly SessionEntry[];
  readonly requests: ModelServer["requests"];
}

async function runContinueScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const workspace = await createRpcWorkspace();
  try {
    const server = await startModelServer();
    try {
      if (options.localModel !== false) await writeModelsJson(workspace.agentDir, server.baseUrl);
      options.build(workspace.session);
      const host = await startPiRpc({
        agentDir: workspace.agentDir,
        sessionDir: workspace.sessionDir,
        sessionFile: workspace.sessionFile,
        ...(options.model === undefined ? {} : { model: options.model }),
      });
      try {
        await options.drive(host, server);
        return {
          messages: host.messages,
          notifications: host.notifications(),
          entries: await host.entries(),
          requests: server.requests,
        };
      } finally {
        await host.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    await removeRpcWorkspace(workspace.agentDir);
  }
}

async function continueOnce(host: PiRpcHost): Promise<void> {
  await host.prompt("/continue");
  await host.waitForSettled(1);
}

/** No turn may start: wait for the command's notice, then confirm the host is idle. */
async function commandWithoutTurn(host: PiRpcHost, message: string): Promise<void> {
  await host.prompt(message);
  await host.waitForMessage(
    (entry) => entry["type"] === "extension_ui_request" && entry["method"] === "notify",
    "the command's notice",
  );
  const state = await host.command({ type: "get_state" });
  expect(state["data"]).toMatchObject({ isStreaming: false });
}

describe("findInterruptedTurn", () => {
  it("finds an aborted turn through later model metadata", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage());
    const abortedId = session.appendMessage(assistantMessage("aborted"));
    session.appendModelChange("openai", "gpt-5.4");

    expect(findInterruptedTurn(session.getBranch())).toEqual({
      entryId: abortedId,
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });

  it("does not resume a completed turn", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage());
    session.appendMessage(assistantMessage("stop"));

    expect(findInterruptedTurn(session.getBranch())).toBeUndefined();
  });

  it("does not resume an older interruption after a newer message", () => {
    const session = SessionManager.inMemory();
    appendAbortedTurn(session);
    session.appendMessage(userMessage("A newer request"));

    expect(findInterruptedTurn(session.getBranch())).toBeUndefined();
  });

  it("finds a failed turn through a persisted hidden retry marker", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage());
    const failedId = session.appendMessage(assistantMessage("error"));
    session.appendCustomMessageEntry("pi-continue:retry", [], false);

    expect(findInterruptedTurn(session.getBranch())).toEqual({
      entryId: failedId,
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });
});

describe("/continue", () => {
  it("retries an aborted turn with the currently selected model", async () => {
    const result = await runContinueScenario({
      model: LOCAL,
      build: (session) => {
        appendAbortedTurn(session);
        session.appendModelChange(LOCAL_PROVIDER, LOCAL_MODEL);
      },
      drive: continueOnce,
    });

    expect(result.notifications).toEqual([
      {
        message: `Retrying interrupted or failed work with ${LOCAL} (previously anthropic/claude-sonnet)`,
        type: "info",
      },
    ]);
    const markers = customMessages(result.messages);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      role: "custom",
      customType: "pi-continue:retry",
      content: [],
      display: false,
    });
    // The model saw the original request only: neither the aborted reply nor the marker.
    expect(result.requests).toHaveLength(1);
    expect(conversationOf(result.requests[0])).toEqual(ORIGINAL_REQUEST);
    // The retried turn completed against the real model stack.
    expect(lastStopReason(result.entries)).toBe("stop");
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
    expect(retryMarkers(result.entries)).toHaveLength(1);
  });

  it("retries a provider error with the newly selected model", async () => {
    const result = await runContinueScenario({
      model: LOCAL,
      build: (session) => {
        session.appendMessage(userMessage());
        session.appendMessage(assistantMessage("error", "openrouter", "stealth/ox-alpha"));
        session.appendModelChange(LOCAL_PROVIDER, LOCAL_MODEL);
      },
      drive: continueOnce,
    });

    expect(result.notifications).toEqual([
      {
        message: `Retrying interrupted or failed work with ${LOCAL} (previously openrouter/stealth/ox-alpha)`,
        type: "info",
      },
    ]);
    expect(customMessages(result.messages)).toHaveLength(1);
    // The failed reply and the marker are both removed from what the model receives.
    expect(result.requests).toHaveLength(1);
    expect(conversationOf(result.requests[0])).toEqual(ORIGINAL_REQUEST);
    expect(lastStopReason(result.entries)).toBe("stop");
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("removes retry markers and their failed assistant turns from every model context", async () => {
    const agentDir = await makeTemporaryDirectory("pi-continue-context-");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const session = SessionManager.create(agentDir, join(agentDir, "sessions"));
    session.appendMessage(userMessage("Do the first task"));
    session.appendMessage(assistantMessage("stop"));
    session.appendMessage(userMessage("Try another task"));
    const failedId = session.appendMessage(assistantMessage("error"));
    const markerId = session.appendCustomMessageEntry("pi-continue:retry", [], false);
    session.appendMessage(userMessage("And a third"));
    const abortedId = session.appendMessage(assistantMessage("aborted"));
    const secondMarkerId = session.appendCustomMessageEntry("pi-continue:retry", [], false);
    session.appendCustomMessageEntry("other-extension", "Keep this context", false);

    const loaded = await loadPiContinue(agentDir);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      agentDir,
      session,
      new ModelRegistry(modelRuntime),
    );
    const errors: string[] = [];
    runner.onError((error) => {
      errors.push(`${error.event}: ${error.error}`);
    });

    const context = await runner.emitContext(
      session.getBranch().flatMap(sessionEntryToContextMessages),
    );
    const removed = new Set([failedId, markerId, abortedId, secondMarkerId]);
    const expected = session
      .getBranch()
      .filter((entry) => !removed.has(entry.id))
      .flatMap(sessionEntryToContextMessages);

    expect(context).toEqual(expected);
    expect(errors).toEqual([]);
    expect(
      context.some(
        (message) => message.role === "custom" && message.customType === "other-extension",
      ),
    ).toBe(true);
  });

  it("waits for a streaming turn's abort to settle before reading the branch", async () => {
    const result = await runContinueScenario({
      model: LOCAL,
      build: (session) => {
        session.appendModelChange(LOCAL_PROVIDER, LOCAL_MODEL);
      },
      drive: async (host, server) => {
        // A real turn is streaming: the model's reply is held.
        const release = server.holdNext();
        try {
          await host.prompt("Do the task");
          await server.waitForRequests(1);
          // /continue arrives while the turn still streams; only then is it aborted.
          const continued = host.prompt("/continue");
          await host.command({ type: "abort" });
          await continued;
          // The aborted turn settles, then the retried one.
          await host.waitForSettled(2);
        } finally {
          release();
        }
      },
    });

    // The command saw the aborted turn the abort produced, not a still-running one.
    expect(result.notifications).toEqual([
      { message: `Retrying interrupted or failed work with ${LOCAL}`, type: "info" },
    ]);
    expect(result.requests).toHaveLength(2);
    expect(conversationOf(result.requests[1])).toEqual(ORIGINAL_REQUEST);
    expect(lastStopReason(result.entries)).toBe("stop");
    expect(
      result.entries.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.stopReason === "aborted",
      ),
    ).toBe(true);
    expect(retryMarkers(result.entries)).toHaveLength(1);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("rejects model arguments instead of switching models", async () => {
    const result = await runContinueScenario({
      model: LOCAL,
      build: (session) => {
        appendAbortedTurn(session);
        session.appendModelChange(LOCAL_PROVIDER, LOCAL_MODEL);
      },
      drive: (host) => commandWithoutTurn(host, `/continue --model ${LOCAL}`),
    });

    expect(result.notifications).toEqual([{ message: "Usage: /continue", type: "warning" }]);
    expect(customMessages(result.messages)).toEqual([]);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(false);
    expect(result.requests).toEqual([]);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("does nothing when the latest turn was not interrupted", async () => {
    const result = await runContinueScenario({
      model: LOCAL,
      build: (session) => {
        session.appendMessage(userMessage());
        session.appendMessage(assistantMessage("stop"));
      },
      drive: (host) => commandWithoutTurn(host, "/continue"),
    });

    expect(result.notifications).toEqual([
      { message: "No interrupted or failed turn to continue", type: "warning" },
    ]);
    expect(customMessages(result.messages)).toEqual([]);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(false);
    expect(result.requests).toEqual([]);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("requires a currently selected model", async () => {
    const result = await runContinueScenario({
      // No models.json and no --model: Pi starts with no model selected.
      localModel: false,
      build: (session) => {
        appendAbortedTurn(session);
      },
      drive: (host) => commandWithoutTurn(host, "/continue"),
    });

    expect(result.notifications).toEqual([{ message: "No model selected", type: "error" }]);
    expect(customMessages(result.messages)).toEqual([]);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(false);
    expect(retryMarkers(result.entries)).toEqual([]);
    expect(result.requests).toEqual([]);
  });
});
