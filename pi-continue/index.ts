import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

export const CONTINUATION_PROMPT =
  "Continue the previously interrupted or failed task using the current model. Review the conversation and current workspace state, determine what completed before the interruption or failure, and resume from the first unfinished step. Verify state before repeating any unfinished tool action, do not redo completed work, and finish the original request.";

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
  pi.registerCommand("continue", {
    description: "Resume the interrupted or failed turn with the currently selected model",
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

      ctx.ui.notify(`Continuing interrupted or failed work with ${modelNote}`, "info");
      pi.sendUserMessage(CONTINUATION_PROMPT);
    },
  });
}
