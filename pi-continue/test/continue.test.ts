import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piContinue, { CONTINUATION_PROMPT, findInterruptedTurn } from "../index.ts";

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

function userEntry(id: string, text = "Do the task"): SessionEntry {
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
  stopReason: "stop" | "aborted",
  provider = "anthropic",
  model = "claude-sonnet",
): SessionEntry {
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

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

function registerExtension() {
  let command: CommandOptions | undefined;
  const sendUserMessage = vi.fn<(content: string) => void>();
  const registerCommand = vi.fn<(name: string, options: CommandOptions) => void>(
    (name, options) => {
      expect(name).toBe("continue");
      command = options;
    },
  );

  piContinue({ registerCommand, sendUserMessage } as unknown as ExtensionAPI);

  if (!command) throw new Error("/continue was not registered");
  return { command, registerCommand, sendUserMessage };
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
});

describe("/continue", () => {
  it("continues an aborted turn with the currently selected model", async () => {
    const { command, sendUserMessage } = registerExtension();
    const entries = [
      userEntry("user"),
      assistantEntry("aborted", "aborted"),
      modelChangeEntry("model", "openai", "gpt-5.4"),
    ];
    const { ctx, notify, waitForIdle } = commandContext(() => entries);

    await command.handler("", ctx);

    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledExactlyOnceWith(CONTINUATION_PROMPT);
    expect(notify).toHaveBeenCalledWith(
      "Continuing interrupted work with openai/gpt-5.4 (interrupted on anthropic/claude-sonnet)",
      "info",
    );
  });

  it("checks the settled branch after waiting for the abort", async () => {
    const { command, sendUserMessage } = registerExtension();
    let entries: SessionEntry[] = [];
    const { ctx, waitForIdle } = commandContext(() => entries);
    waitForIdle.mockImplementation(async () => {
      entries = [userEntry("user"), assistantEntry("aborted", "aborted")];
    });

    await command.handler("", ctx);

    expect(sendUserMessage).toHaveBeenCalledExactlyOnceWith(CONTINUATION_PROMPT);
  });

  it("rejects model arguments instead of switching models", async () => {
    const { command, sendUserMessage } = registerExtension();
    const { ctx, notify, waitForIdle } = commandContext(() => [
      userEntry("user"),
      assistantEntry("aborted", "aborted"),
    ]);

    await command.handler("--model openai/gpt-5.4", ctx);

    expect(notify).toHaveBeenCalledWith("Usage: /continue", "warning");
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the latest turn was not interrupted", async () => {
    const { command, sendUserMessage } = registerExtension();
    const { ctx, notify } = commandContext(() => [
      userEntry("user"),
      assistantEntry("done", "stop"),
    ]);

    await command.handler("", ctx);

    expect(notify).toHaveBeenCalledWith("No interrupted turn to continue", "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("requires a currently selected model", async () => {
    const { command, sendUserMessage } = registerExtension();
    const { ctx, notify } = commandContext(
      () => [userEntry("user"), assistantEntry("aborted", "aborted")],
      null,
    );

    await command.handler("", ctx);

    expect(notify).toHaveBeenCalledWith("No model selected", "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
