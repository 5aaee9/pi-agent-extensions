import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

const CONTINUATION_TRIGGER_TYPE = "pi-continue:retry";

/** Keys that retry the interrupted turn without typing `/continue`. */
const SHORTCUTS = ["f5", "alt+r"] as const;

const COMMAND_DESCRIPTION =
  "Retry the interrupted or failed turn with the currently selected model";
const SHORTCUT_DESCRIPTION = "Continue the interrupted turn";

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

/**
 * Wait for an abort to settle, and report whether the session is free to retry.
 *
 * A key does not wait behind a run the user has not interrupted: that wait would outlive the
 * press and take the user's later Esc for a turn to retry, restarting what they just stopped.
 * The base context a shortcut handler receives has no `waitForIdle()`, so this polls.
 */
async function settleAbort(ctx: ExtensionContext): Promise<boolean> {
  if (ctx.isIdle()) return true;
  if (!ctx.signal?.aborted) return false;
  while (!ctx.isIdle()) {
    // A signal that is not aborted belongs to a newer run, started after this key was pressed.
    if (ctx.signal && !ctx.signal.aborted) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/** Retry the interrupted turn. The caller has already waited for the session to be free. */
function retryInterruptedTurn(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const interrupted = findInterruptedTurn(ctx.sessionManager.getBranch());
  if (!interrupted) {
    ctx.ui.notify("No interrupted or failed turn to continue", "warning");
    return;
  }

  // With nothing selected Pi still reports a placeholder model ("unknown/unknown"),
  // so a model counts as selected only when the registry knows it.
  if (!ctx.model || ctx.modelRegistry.find(ctx.model.provider, ctx.model.id) === undefined) {
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
}

export default function piContinue(pi: ExtensionAPI) {
  // sendMessage() is the public extension seam for starting a turn without a user message.
  // Remove its empty marker before every LLM call: Pi converts it to an empty user message,
  // which not every adapter drops. Pi itself drops the failed turn the retry replaces.
  pi.on("context", (event) => {
    const messages = event.messages.filter(
      (message) => !(message.role === "custom" && message.customType === CONTINUATION_TRIGGER_TYPE),
    );
    return messages.length === event.messages.length ? undefined : { messages };
  });

  pi.registerCommand("continue", {
    description: COMMAND_DESCRIPTION,
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /continue", "warning");
        return;
      }
      // An abort can still be settling tool results when the command is submitted.
      await ctx.waitForIdle();
      retryInterruptedTurn(pi, ctx);
      // sendMessage does not return the run it starts, and print and JSON modes
      // dispose the session when the command returns. Other modes stay responsive.
      if (ctx.mode === "print" || ctx.mode === "json") await ctx.waitForIdle();
    },
  });

  for (const shortcut of SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: SHORTCUT_DESCRIPTION,
      handler: async (ctx) => {
        if (await settleAbort(ctx)) retryInterruptedTurn(pi, ctx);
        else ctx.ui.notify("Cannot continue while the agent is busy", "warning");
      },
    });
  }
}
