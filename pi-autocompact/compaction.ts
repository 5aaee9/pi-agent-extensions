import {
  estimateTokens,
  generateSummaryWithUsage,
  type BoundaryState,
  type CompactionEntryDraft,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Work on the boundary's projected context, not raw history: context edits,
 * earlier summaries and other extensions' proposed entries must be respected.
 * Never leave tool results without their assistant tool call. */
export function planCompaction(context: BoundaryState["context"], keepRecentTokens: number) {
  const contributions = context.contextEntries.filter((entry) => entry.messages.length > 0);
  let recentTokens = 0;
  let cut = -1;
  for (let index = contributions.length - 1; index >= 0; index--) {
    const messages = contributions[index].messages;
    recentTokens += messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    const role = messages[0].role;
    if (role === "user" || role === "assistant") cut = index;
    if (recentTokens >= keepRecentTokens && cut >= 0) break;
  }
  // A small session or one indivisible oversized message cannot safely retain
  // recent content and shrink. Leave it to native overflow/manual compaction.
  if (cut <= 0) return undefined;
  return {
    firstKeptEntryId: contributions[cut].sourceEntry.id,
    messages: contributions.slice(0, cut).flatMap((entry) => entry.messages),
  };
}

export async function summarizeBoundary(
  context: BoundaryState["context"],
  ctx: ExtensionContext,
  settings: { keepRecentTokens: number; reserveTokens: number },
  signal: AbortSignal,
): Promise<CompactionEntryDraft | undefined> {
  if (!ctx.model) return undefined;
  const plan = planCompaction(context, settings.keepRecentTokens);
  if (!plan) return undefined;
  const summary = await generateSummaryWithUsage(
    plan.messages,
    ctx.model,
    settings.reserveTokens,
    undefined,
    undefined,
    signal,
    undefined,
    undefined,
    ctx.thinkingLevel,
    (model, transcript, options) => ctx.modelRegistry.stream(model, transcript, options),
  );
  return {
    type: "compaction",
    summary: summary.text,
    firstKeptEntryId: plan.firstKeptEntryId,
    usage: summary.usage,
    details: { source: "pi-autocompact" },
  };
}
