// Renders release intents as plain `- <summary>` bullets, matching the
// existing CHANGELOG.md style (no commit-hash prefix).
import type { GetDependencyReleaseLine, GetReleaseLine } from "@changesets/types";

function renderReleaseLine({ summary }: { readonly summary: string }): string {
  const [firstLine = "", ...rest] = summary.split("\n").map((line) => line.trimEnd());
  const continuation = rest.map((line) => (line === "" ? line : `  ${line}`));
  return [`- ${firstLine}`, ...continuation].join("\n");
}

export const getReleaseLine: GetReleaseLine = renderReleaseLine;

// The packages do not depend on each other, so dependency bumps add no lines.
export const getDependencyReleaseLine: GetDependencyReleaseLine = () => "";
