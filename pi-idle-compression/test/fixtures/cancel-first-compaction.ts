import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function cancelFirstCompaction(pi: ExtensionAPI): void {
  let first = true;
  pi.on("session_before_compact", () => {
    if (!first) return;
    first = false;
    return { cancel: true };
  });
}
