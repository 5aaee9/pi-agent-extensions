import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

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
 * Wait until no run, retry, or compaction is in flight.
 *
 * Command handlers get `waitForIdle()`; the base context a shortcut handler receives does not,
 * so it polls `isIdle()` instead. An abort can still be settling tool results either way.
 */
async function settle(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
  if ("waitForIdle" in ctx) {
    await ctx.waitForIdle();
    return;
  }
  while (!ctx.isIdle()) await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Retry the interrupted turn. Shared by `/continue` and the shortcuts. */
async function continueTurn(
  pi: ExtensionAPI,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<void> {
  await settle(ctx);

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
  // sendMessage does not return the run it starts, and print and JSON modes
  // dispose the session when the command returns. Other modes stay responsive.
  if (ctx.mode === "print" || ctx.mode === "json") await settle(ctx);
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
      await continueTurn(pi, ctx);
    },
  });

  for (const shortcut of SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: SHORTCUT_DESCRIPTION,
      handler: async (ctx) => await continueTurn(pi, ctx),
    });
  }
}
