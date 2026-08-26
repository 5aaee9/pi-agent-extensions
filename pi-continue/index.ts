import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

const CONTINUATION_TRIGGER_TYPE = "pi-continue:retry";

export interface InterruptedTurn {
  entryId: string;
  provider: string;
  model: string;
}

/** Find an interrupted or failed turn at the end of the current conversational branch. */
export function findInterruptedTurn(entries: readonly SessionEntry[]): InterruptedTurn | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message.role === "custom" && message.customType === CONTINUATION_TRIGGER_TYPE) continue;
    if (
      message.role !== "assistant" ||
      (message.stopReason !== "aborted" && message.stopReason !== "error")
    ) {
      return undefined;
    }

    return {
      entryId: entry.id,
      provider: message.provider,
      model: message.model,
    };
  }

  return undefined;
}

export default function piContinue(pi: ExtensionAPI) {
  // sendMessage() is the public extension seam for starting a turn without a user message.
  // Remove its hidden marker and the paired incomplete assistant response before every LLM call,
  // leaving the original user message or tool result as the retry boundary.
  pi.on("context", (event) => {
    const messages: typeof event.messages = [];
    let changed = false;

    for (const message of event.messages) {
      if (message.role === "custom" && message.customType === CONTINUATION_TRIGGER_TYPE) {
        const previous = messages[messages.length - 1];
        if (
          previous?.role === "assistant" &&
          (previous.stopReason === "aborted" || previous.stopReason === "error")
        ) {
          messages.pop();
        }
        changed = true;
        continue;
      }

      messages.push(message);
    }

    return changed ? { messages } : undefined;
  });

  pi.registerCommand("continue", {
    description: "Retry the interrupted or failed turn with the currently selected model",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /continue", "warning");
        return;
      }

      // An abort can still be settling tool results when the command is submitted.
      await ctx.waitForIdle();

      const interrupted = findInterruptedTurn(ctx.sessionManager.getBranch());
      if (!interrupted) {
        ctx.ui.notify("No interrupted or failed turn to continue", "warning");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const currentModel = `${ctx.model.provider}/${ctx.model.id}`;
      const interruptedModel = `${interrupted.provider}/${interrupted.model}`;
      const modelNote =
        currentModel === interruptedModel
          ? currentModel
          : `${currentModel} (previously ${interruptedModel})`;

      ctx.ui.notify(`Retrying interrupted or failed work with ${modelNote}`, "info");
      // The context hook removes this marker before it reaches the model.
      pi.sendMessage(
        {
          customType: CONTINUATION_TRIGGER_TYPE,
          content: [],
          display: false,
        },
        { triggerTurn: true },
      );
    },
  });
}
