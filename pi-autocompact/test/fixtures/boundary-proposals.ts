import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function boundaryProposals(pi: ExtensionAPI): void {
  pi.on("turn_end", (event) => ({
    entries: [
      ...event.entries,
      { type: "custom", customType: "boundary-probe", data: { saved: true } },
      { type: "context_edit", targetId: event.messageEntryId, replacement: null },
    ],
  }));
}
