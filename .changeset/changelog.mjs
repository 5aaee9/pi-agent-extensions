// Renders release intents as plain `- <summary>` bullets, matching the
// existing CHANGELOG.md style (no commit-hash prefix).
export function getReleaseLine(changeset) {
  const [firstLine, ...rest] = changeset.summary.split("\n").map((line) => line.trimEnd());
  const continuation = rest.map((line) => (line ? `  ${line}` : line));
  return [`- ${firstLine}`, ...continuation].join("\n");
}

// The packages do not depend on each other, so dependency bumps add no lines.
export function getDependencyReleaseLine() {
  return "";
}
