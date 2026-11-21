import { asRecord } from "./util.ts";

// Official Codex puts base instructions in a developer input item and does not
// send top-level instructions, for every model family. Pi already omits
// instructions. A Codex model that Pi does not mark as reasoning still sends
// its prompt as system, which a Codex OAuth gateway then copies into
// instructions. Renaming the role keeps Pi's own text in input. The gateway's
// own default, if it still injects one, is left untouched. On GPT-6.1 and
// older that default can still be cached; this rename is not a billing fix.
export function preserveCodexDeveloperPrompt(
  payload: unknown,
  model: { id: string; api: string } | undefined,
): Record<string, unknown> | undefined {
  if (model?.api !== "openai-codex-responses") return undefined;
  const request = asRecord(payload);
  if (!request || request.model !== model.id || !Array.isArray(request.input)) return undefined;

  let changed = false;
  const input = request.input.map((item) => {
    const message = asRecord(item);
    if (!message || message.role !== "system") return item;
    changed = true;
    return { ...message, role: "developer" };
  });
  return changed ? { ...request, input } : undefined;
}
