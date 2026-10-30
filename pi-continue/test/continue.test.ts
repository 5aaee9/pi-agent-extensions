import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
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
  type RpcMessage,
  createRpcWorkspace,
  customMessages,
  removeRpcWorkspace,
  startPiRpc,
} from "./pi-rpc.ts";

type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const loaderUrl = pathToFileURL(join(dirname(codingAgentEntry), "core/extensions/loader.js")).href;

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

interface ExtensionLoaderModule {
  loadExtensions(paths: string[], cwd: string): Promise<LoadExtensionsResult>;
}

async function loadPiContinue(agentDir: string): Promise<LoadExtensionsResult> {
  const loader = (await import(loaderUrl)) as ExtensionLoaderModule;
  const result = await loader.loadExtensions([extensionPath], agentDir);
  expect(result.errors).toEqual([]);
  return result;
}

function isUserMessage(entry: SessionEntry): boolean {
  return entry.type === "message" && entry.message.role === "user";
}

interface ScenarioOptions {
  readonly model: string;
  readonly build: (session: SessionManager) => void;
  readonly prompts: readonly string[];
  readonly turns: number;
}

interface ScenarioResult {
  readonly messages: readonly RpcMessage[];
  readonly notifications: readonly {
    readonly message: string;
    readonly type: string | undefined;
  }[];
  readonly entries: readonly SessionEntry[];
}

async function runContinueScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const workspace = await createRpcWorkspace();
  try {
    options.build(workspace.session);
    const host = await startPiRpc({
      agentDir: workspace.agentDir,
      sessionDir: workspace.sessionDir,
      sessionFile: workspace.sessionFile,
      model: options.model,
    });
    try {
      for (const prompt of options.prompts) await host.prompt(prompt);
      if (options.turns > 0) await host.waitForSettled(options.turns);
      return {
        messages: host.messages,
        notifications: host.notifications(),
        entries: await host.entries(),
      };
    } finally {
      await host.close();
    }
  } finally {
    await removeRpcWorkspace(workspace.agentDir);
  }
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
  it("continues an aborted turn with the currently selected model", async () => {
    const result = await runContinueScenario({
      model: "openai/gpt-5.4",
      build: (session) => {
        appendAbortedTurn(session);
        session.appendModelChange("openai", "gpt-5.4");
      },
      prompts: ["/continue"],
      turns: 1,
    });

    expect(result.notifications).toEqual([
      {
        message:
          "Retrying interrupted or failed work with openai/gpt-5.4 (previously anthropic/claude-sonnet)",
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
    expect(result.messages.some((message) => message["type"] === "turn_start")).toBe(true);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(true);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
    expect(
      result.entries.filter(
        (entry) => entry.type === "custom_message" && entry.customType === "pi-continue:retry",
      ),
    ).toHaveLength(1);
  });

  it("continues a provider error with the newly selected model", async () => {
    const result = await runContinueScenario({
      model: "anthropic/claude-sonnet-5",
      build: (session) => {
        session.appendMessage(userMessage());
        session.appendMessage(assistantMessage("error", "openrouter", "stealth/ox-alpha"));
        session.appendModelChange("anthropic", "claude-sonnet-5");
      },
      prompts: ["/continue"],
      turns: 1,
    });

    expect(result.notifications).toEqual([
      {
        message:
          "Retrying interrupted or failed work with anthropic/claude-sonnet-5 (previously openrouter/stealth/ox-alpha)",
        type: "info",
      },
    ]);
    expect(customMessages(result.messages)).toHaveLength(1);
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
    const expected = session
      .getBranch()
      .filter((entry) => entry.id !== failedId && entry.id !== markerId)
      .flatMap(sessionEntryToContextMessages);

    expect(context).toEqual(expected);
    expect(errors).toEqual([]);
    expect(
      context.some(
        (message) => message.role === "custom" && message.customType === "other-extension",
      ),
    ).toBe(true);
  });

  it("checks the settled branch after waiting for the abort", async () => {
    const result = await runContinueScenario({
      model: "openai/gpt-5.4",
      build: (session) => {
        appendAbortedTurn(session);
        session.appendModelChange("openai", "gpt-5.4");
      },
      prompts: ["/continue", "/continue"],
      turns: 2,
    });

    expect(result.notifications).toEqual([
      {
        message:
          "Retrying interrupted or failed work with openai/gpt-5.4 (previously anthropic/claude-sonnet)",
        type: "info",
      },
      {
        message: "Retrying interrupted or failed work with openai/gpt-5.4",
        type: "info",
      },
    ]);
    expect(
      result.entries.filter(
        (entry) => entry.type === "custom_message" && entry.customType === "pi-continue:retry",
      ),
    ).toHaveLength(2);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("rejects model arguments instead of switching models", async () => {
    const result = await runContinueScenario({
      model: "openai/gpt-5.4",
      build: (session) => {
        appendAbortedTurn(session);
        session.appendModelChange("openai", "gpt-5.4");
      },
      prompts: ["/continue --model openai/gpt-5.4"],
      turns: 0,
    });

    expect(result.notifications).toEqual([{ message: "Usage: /continue", type: "warning" }]);
    expect(customMessages(result.messages)).toEqual([]);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(false);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("does nothing when the latest turn was not interrupted", async () => {
    const result = await runContinueScenario({
      model: "openai/gpt-5.4",
      build: (session) => {
        session.appendMessage(userMessage());
        session.appendMessage(assistantMessage("stop"));
      },
      prompts: ["/continue"],
      turns: 0,
    });

    expect(result.notifications).toEqual([
      { message: "No interrupted or failed turn to continue", type: "warning" },
    ]);
    expect(customMessages(result.messages)).toEqual([]);
    expect(result.messages.some((message) => message["type"] === "agent_start")).toBe(false);
    expect(result.entries.filter(isUserMessage)).toHaveLength(1);
  });

  it("requires a currently selected model", async () => {
    const agentDir = await makeTemporaryDirectory("pi-continue-no-model-");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const session = SessionManager.create(agentDir, join(agentDir, "sessions"));
    appendAbortedTurn(session);
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

    const command = runner.getCommand("continue");
    if (command === undefined) throw new Error("/continue was not registered");
    const entryCount = session.getEntries().length;
    await command.handler("", runner.createCommandContext());

    expect(errors).toEqual([]);
    expect(session.getEntries()).toHaveLength(entryCount);
    expect(
      session
        .getBranch()
        .some(
          (entry) => entry.type === "custom_message" && entry.customType === "pi-continue:retry",
        ),
    ).toBe(false);
  });
});
