import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piContinue, { findInterruptedTurn } from "../index.ts";

type MessageEntry = Extract<SessionEntry, { type: "message" }>;
type ContextHandler = (event: ContextEvent) => { messages: ContextEvent["messages"] } | undefined;

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

function userEntry(id: string, text = "Do the task"): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "user",
      content: text,
      timestamp: 1,
    },
  };
}

function assistantEntry(
  id: string,
  stopReason: "stop" | "aborted" | "error",
  provider = "anthropic",
  model = "claude-sonnet",
): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Partial work" }],
      api: "anthropic-messages",
      provider,
      model,
      usage,
      stopReason,
      ...(stopReason === "error" ? { errorMessage: "429: Provider returned error" } : {}),
      timestamp: 2,
    },
  };
}

function modelChangeEntry(id: string, provider: string, modelId: string): SessionEntry {
  return {
    type: "model_change",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:02.000Z",
    provider,
    modelId,
  };
}

function continuationTriggerEntry(id: string): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:03.000Z",
    message: {
      role: "custom",
      customType: "pi-continue:retry",
      content: [],
      display: false,
      timestamp: 3,
    },
  };
}

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

function registerExtension() {
  let command: CommandOptions | undefined;
  let contextHandler: ContextHandler | undefined;
  const sendMessage = vi.fn<ExtensionAPI["sendMessage"]>();
  const sendUserMessage = vi.fn<ExtensionAPI["sendUserMessage"]>();
  const on = vi.fn<(event: string, handler: unknown) => void>((event, handler) => {
    if (event === "context") contextHandler = handler as ContextHandler;
  });
  const registerCommand = vi.fn<(name: string, options: CommandOptions) => void>(
    (name, options) => {
      expect(name).toBe("continue");
      command = options;
    },
  );

  piContinue({ on, registerCommand, sendMessage, sendUserMessage } as unknown as ExtensionAPI);

  if (!command) throw new Error("/continue was not registered");
  if (!contextHandler) throw new Error("context handler was not registered");
  return { command, contextHandler, on, registerCommand, sendMessage, sendUserMessage };
}

function commandContext(
  entries: () => SessionEntry[],
  model: { provider: string; id: string } | null = {
    provider: "openai",
    id: "gpt-5.4",
  },
) {
  const notify = vi.fn<(message: string, level: "info" | "warning" | "error") => void>();
  const waitForIdle = vi.fn<() => Promise<void>>(async () => undefined);
  const getBranch = vi.fn<() => SessionEntry[]>(entries);

  return {
    ctx: {
      model: model ?? undefined,
      sessionManager: { getBranch },
      ui: { notify },
      waitForIdle,
    } as unknown as ExtensionCommandContext,
    getBranch,
    notify,
    waitForIdle,
  };
}

describe("findInterruptedTurn", () => {
  it("finds an aborted turn through later model metadata", () => {
    const entries = [
      userEntry("user"),
      assistantEntry("aborted", "aborted"),
      modelChangeEntry("model", "openai", "gpt-5.4"),
    ];

    expect(findInterruptedTurn(entries)).toEqual({
      entryId: "aborted",
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });

  it("does not resume a completed turn", () => {
    expect(
      findInterruptedTurn([userEntry("user"), assistantEntry("done", "stop")]),
    ).toBeUndefined();
  });

  it("does not resume an older interruption after a newer message", () => {
    expect(
      findInterruptedTurn([
        userEntry("user"),
        assistantEntry("aborted", "aborted"),
        userEntry("new-user", "A newer request"),
      ]),
    ).toBeUndefined();
  });

  it("finds a failed turn through a persisted hidden retry marker", () => {
    expect(
      findInterruptedTurn([
        userEntry("user"),
        assistantEntry("failed", "error"),
        continuationTriggerEntry("trigger"),
      ]),
    ).toEqual({
      entryId: "failed",
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });
});

describe("/continue", () => {
  it("continues an aborted turn with the currently selected model", async () => {
    const { command, contextHandler, sendMessage, sendUserMessage } = registerExtension();
    const user = userEntry("user");
    const aborted = assistantEntry("aborted", "aborted");
    const entries = [user, aborted, modelChangeEntry("model", "openai", "gpt-5.4")];
    const { ctx, notify, waitForIdle } = commandContext(() => entries);

    await command.handler("", ctx);

    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      {
        customType: "pi-continue:retry",
        content: [],
        display: false,
      },
      { triggerTurn: true },
    );
    expect(notify).toHaveBeenCalledWith(
      "Retrying interrupted or failed work with openai/gpt-5.4 (previously anthropic/claude-sonnet)",
      "info",
    );

    const trigger = {
      role: "custom" as const,
      ...sendMessage.mock.calls[0]![0],
      timestamp: 3,
    };
    expect(
      contextHandler({
        type: "context",
        messages: [user.message, aborted.message, trigger],
      }),
    ).toEqual({ messages: [user.message] });
  });

  it("continues a provider error with the newly selected model", async () => {
    const { command, sendMessage, sendUserMessage } = registerExtension();
    const entries = [
      userEntry("user"),
      assistantEntry("rate-limited", "error", "openrouter", "stealth/ox-alpha"),
      modelChangeEntry("model", "anthropic", "claude-sonnet"),
    ];
    const { ctx, notify } = commandContext(() => entries, {
      provider: "anthropic",
      id: "claude-sonnet",
    });

    await command.handler("", ctx);

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      "Retrying interrupted or failed work with anthropic/claude-sonnet (previously openrouter/stealth/ox-alpha)",
      "info",
    );
  });

  it("removes retry markers and their failed assistant turns from every model context", () => {
    const { contextHandler } = registerExtension();
    const firstUser = userEntry("first-user").message;
    const completed = assistantEntry("completed", "stop").message;
    const secondUser = userEntry("second-user", "Try another task").message;
    const failed = assistantEntry("failed", "error").message;
    const marker = {
      role: "custom" as const,
      customType: "pi-continue:retry",
      content: [],
      display: false,
      timestamp: 3,
    };
    const otherCustom = {
      role: "custom" as const,
      customType: "other-extension",
      content: "Keep this context",
      display: false,
      timestamp: 4,
    };

    expect(
      contextHandler({
        type: "context",
        messages: [firstUser, completed, secondUser, failed, marker, otherCustom],
      }),
    ).toEqual({ messages: [firstUser, completed, secondUser, otherCustom] });
  });

  it("checks the settled branch after waiting for the abort", async () => {
    const { command, sendMessage, sendUserMessage } = registerExtension();
    let entries: SessionEntry[] = [];
    const { ctx, waitForIdle } = commandContext(() => entries);
    waitForIdle.mockImplementation(async () => {
      entries = [userEntry("user"), assistantEntry("aborted", "aborted")];
    });

    await command.handler("", ctx);

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("rejects model arguments instead of switching models", async () => {
    const { command, sendMessage, sendUserMessage } = registerExtension();
    const { ctx, notify, waitForIdle } = commandContext(() => [
      userEntry("user"),
      assistantEntry("aborted", "aborted"),
    ]);

    await command.handler("--model openai/gpt-5.4", ctx);

    expect(notify).toHaveBeenCalledWith("Usage: /continue", "warning");
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the latest turn was not interrupted", async () => {
    const { command, sendMessage, sendUserMessage } = registerExtension();
    const { ctx, notify } = commandContext(() => [
      userEntry("user"),
      assistantEntry("done", "stop"),
    ]);

    await command.handler("", ctx);

    expect(notify).toHaveBeenCalledWith("No interrupted or failed turn to continue", "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("requires a currently selected model", async () => {
    const { command, sendMessage, sendUserMessage } = registerExtension();
    const { ctx, notify } = commandContext(
      () => [userEntry("user"), assistantEntry("aborted", "aborted")],
      null,
    );

    await command.handler("", ctx);

    expect(notify).toHaveBeenCalledWith("No model selected", "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
